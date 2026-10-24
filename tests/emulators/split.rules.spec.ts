import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approvalData,
  expenseUpdateData,
  fiscalKeyData,
  newExpenseData,
  newInstallmentSeriesData,
  type ExpenseInput,
  type ReceiptChoice,
} from '../../src/services/expenseData';
import { checkDigit } from '../../functions/src/nfce';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// Divisão diferente de 50/50 vai sempre para aprovação, mesmo com comprovante.
const A = 'uid-a';
const B = 'uid-b';
const GROUP = 'group-1';

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();
const keyFor = (serial: string) => {
  const base = `31261011222333000181650${serial.padStart(20, '0')}`;
  return base + checkDigit(base);
};

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});

afterAll(async () => {
  await env.cleanup();
});

const path = (id: string) => `groups/${GROUP}/expenses/${id}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();
const ids = (expenseId: string) => ({ groupId: GROUP, expenseId });
const photo: ReceiptChoice = { type: 'photo', replaced: true };

function input(payerSharePct: number, receipt: ReceiptChoice): ExpenseInput {
  return { description: 'Mercado', totalCents: 20000, personalCents: 0, payerUid: A, payerSharePct, date: `${CURRENT}-05`, receipt };
}

/** Criação como o app monta, com o status trocado (o que um app adulterado tentaria). */
function create(id: string, data: Record<string, unknown>, key?: string) {
  const fs = db(A);
  const batch = fs.batch().set(fs.doc(path(id)), data);
  if (key) batch.set(fs.doc(`groups/${GROUP}/fiscalKeys/${key}`), fiscalKeyData(id, A, serverTime()));
  return batch.commit();
}

const forced = (data: Record<string, unknown>) => ({ ...data, status: 'confirmed', everConfirmed: true });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  });
});

describe('divisão diferente de 50/50', () => {
  it('com foto: o app monta pendente; gravar como confirmado é recusado', async () => {
    const data = newExpenseData(input(70, photo), A, CURRENT, ids('f1'), serverTime());
    expect(data.status).toBe('pending_approval');
    await assertFails(create('f0', forced(newExpenseData(input(70, photo), A, CURRENT, ids('f0'), serverTime()))));
    await assertSucceeds(create('f1', data));
  });

  it('com chave de nota: idem', async () => {
    const key = keyFor('1');
    const choice: ReceiptChoice = { type: 'nfce', nfceKey: key, entry: 'typed' };
    await assertFails(create('k0', forced(newExpenseData(input(30, choice), A, CURRENT, ids('k0'), serverTime())), key));
    await assertSucceeds(create('k1', newExpenseData(input(30, choice), A, CURRENT, ids('k1'), serverTime()), key));
  });

  it('extremos 0 e 100 também vão para aprovação', async () => {
    await assertFails(create('z0', forced(newExpenseData(input(0, photo), A, CURRENT, ids('z0'), serverTime()))));
    await assertFails(create('z1', forced(newExpenseData(input(100, photo), A, CURRENT, ids('z1'), serverTime()))));
  });

  it('50/50 com comprovante continua confirmado automático', async () => {
    const data = newExpenseData(input(50, photo), A, CURRENT, ids('e1'), serverTime());
    expect(data.status).toBe('confirmed');
    await assertSucceeds(create('e1', data));
  });

  it('anexar comprovante a um pendente 70/30 não o confirma', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('p1')).set({ ...newExpenseData(input(70, { type: 'none' }), A, CURRENT, ids('p1'), new Date()), updatedAt: new Date() });
    });
    const data = expenseUpdateData(input(70, photo), CURRENT, ids('p1'), { receipt: { type: 'none' }, status: 'pending_approval' }, serverTime(), removeField());
    expect(data.status).toBe('pending_approval');
    await assertFails(db(A).doc(path('p1')).update({ ...data, status: 'confirmed', everConfirmed: true }));
    await assertSucceeds(db(A).doc(path('p1')).update(data));
  });

  it('mudar a divisão de 50/50 para 70/30 num pendente com comprovante não o confirma', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('p2')).set({ ...newExpenseData(input(50, { type: 'none' }), A, CURRENT, ids('p2'), new Date()), updatedAt: new Date() });
    });
    await assertFails(
      db(A).doc(path('p2')).update({ ...expenseUpdateData(input(70, photo), CURRENT, ids('p2'), { receipt: { type: 'none' }, status: 'pending_approval' }, serverTime(), removeField()), status: 'confirmed', everConfirmed: true }),
    );
  });

  it('recorrente variável: confirmar o valor com comprovante e 70/30 vai para aprovação', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('rec-r1')).set({
        description: 'Luz', totalCents: 0, personalCents: 0, payerUid: A, payerSharePct: 70, date: `${CURRENT}-15`, competence: CURRENT,
        receipt: { type: 'none' }, status: 'awaiting_confirmation', recurringId: 'r1', createdBy: A, createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const value = { ...input(70, photo), description: 'Luz', totalCents: 18000, date: `${CURRENT}-15` };
    const data = expenseUpdateData(value, CURRENT, ids('rec-r1'), { receipt: { type: 'none' }, status: 'awaiting_confirmation' }, serverTime(), removeField());
    expect(data.status).toBe('pending_approval');
    await assertFails(db(A).doc(path('rec-r1')).update({ ...data, status: 'confirmed', everConfirmed: true }));
    await assertSucceeds(db(A).doc(path('rec-r1')).update(data));
  });

  it('série 70/30 com comprovante: todas pendentes, aprovadas uma vez pelo outro (viram Validado)', async () => {
    const parcels = newInstallmentSeriesData({ ...input(70, photo), totalCents: 30000 }, { count: 3, firstMonth: CURRENT }, A, { groupId: GROUP, seriesId: 'serie1' }, serverTime());
    expect(parcels.every((p) => p.data.status === 'pending_approval')).toBe(true);
    const fs = db(A);
    const bad = fs.batch();
    for (const p of parcels) bad.set(fs.doc(path(p.id)), forced(p.data));
    await assertFails(bad.commit());
    const ok = fs.batch();
    for (const p of parcels) ok.set(fs.doc(path(p.id)), p.data);
    await assertSucceeds(ok.commit());
    const other = db(B);
    const approve = other.batch();
    for (const p of parcels) approve.update(other.doc(path(p.id)), approvalData(B, serverTime()));
    await assertSucceeds(approve.commit());
  });

  it('o outro aprova um 70/30 e ele fica confirmado com a aprovação (Validado)', async () => {
    await assertSucceeds(create('v1', newExpenseData(input(70, photo), A, CURRENT, ids('v1'), serverTime())));
    await assertSucceeds(db(B).doc(path('v1')).update(approvalData(B, serverTime())));
  });
});
