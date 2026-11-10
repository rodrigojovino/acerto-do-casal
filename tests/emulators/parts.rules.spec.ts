import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { checkDigit } from '../../functions/src/nfce';
import {
  approvalData,
  expenseUpdateData,
  fiscalKeyData,
  installmentUpdateData,
  newExpenseData,
  newInstallmentSeriesData,
  type ExpenseInput,
} from '../../src/services/expenseData';
import { deviceItemsData } from '../../src/services/nfceItemsData';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// Parte só do parceiro (v0.9.2) e marcações dos itens nas regras.
// UIDs e chaves fictícios: A e B são o casal.
const A = 'uid-a';
const B = 'uid-b';
const GROUP = 'group-1';

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);
const keyFor = (serial: string) => {
  const base = `35261011222333000181650${serial.padStart(20, '0')}`;
  return base + checkDigit(base);
};
const KEY = keyFor('9');

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  });
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const ids = (expenseId: string) => ({ groupId: GROUP, expenseId });

function input(over: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    description: 'Mercado',
    totalCents: 10000,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    receipt: { type: 'none' },
    ...over,
  };
}

/** Gasto novo como o app monta (com a chave e o registro da nota no mesmo lote, se houver). */
function create(id: string, inp: ExpenseInput, over: Record<string, unknown> = {}, uid = A) {
  const fs = db(uid);
  const data = { ...newExpenseData(inp, uid, CURRENT, ids(id), serverTime()), ...over };
  const batch = fs.batch().set(fs.doc(expPath(id)), data);
  if (inp.receipt.type === 'nfce') batch.set(fs.doc(`groups/${GROUP}/fiscalKeys/${inp.receipt.nfceKey}`), fiscalKeyData(id, uid, serverTime()));
  return batch.commit();
}

const MARKS = { m: 'sspos', sig: '0a1b2c3d' };

describe('parte do parceiro no gasto avulso', () => {
  it('sem itens, sem comprovante: aceita, pendente', async () => {
    await assertSucceeds(create('p1', input({ personalCents: 1000, partnerOnlyCents: 2500 })));
  });

  it('com comprovante (nota fiscal), continua indo para aprovação: gravar como confirmado é recusado', async () => {
    const withKey = input({ partnerOnlyCents: 2500, receipt: { type: 'nfce', nfceKey: KEY, entry: 'typed' } });
    await assertFails(create('p2', withKey, { status: 'confirmed', everConfirmed: true }));
    await assertSucceeds(create('p2', withKey));
  });

  it('parte pessoal + parte do parceiro acima do total: recusado', async () => {
    await assertFails(create('p3', input({ personalCents: 6000, partnerOnlyCents: 4001 })));
    await assertSucceeds(create('p3', input({ personalCents: 6000, partnerOnlyCents: 4000 })));
  });

  it('parte do parceiro negativa ou fracionada: recusado', async () => {
    await assertFails(create('p4', input(), { partnerOnlyCents: -1 }));
    await assertFails(create('p5', input(), { partnerOnlyCents: 10.5 }));
    await assertFails(create('p6', input(), { partnerOnlyCents: '100' }));
  });

  it('pendente 50/50 com parte do parceiro ao anexar comprovante: continua pendente', async () => {
    await assertSucceeds(create('p7', input({ partnerOnlyCents: 500 })));
    const fs = db(A);
    const attach = { ...input({ partnerOnlyCents: 500, receipt: { type: 'nfce', nfceKey: KEY, entry: 'typed' } }) };
    const data = expenseUpdateData(attach, CURRENT, ids('p7'), { receipt: { type: 'none' }, status: 'pending_approval' }, serverTime(), removeField());
    const key = fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`);
    await assertFails(fs.batch().update(fs.doc(expPath('p7')), { ...data, status: 'confirmed', everConfirmed: true }).set(key, fiscalKeyData('p7', A, serverTime())).commit());
    await assertSucceeds(fs.batch().update(fs.doc(expPath('p7')), data).set(key, fiscalKeyData('p7', A, serverTime())).commit());
  });

  it('o outro membro aprova, mas não mexe nas partes', async () => {
    await assertSucceeds(create('p8', input({ partnerOnlyCents: 500 })));
    await assertFails(db(B).doc(expPath('p8')).update({ ...approvalData(B, serverTime()), partnerOnlyCents: 0 }));
    await assertSucceeds(db(B).doc(expPath('p8')).update(approvalData(B, serverTime())));
  });

  it('editar um confirmado com parte do parceiro volta para aprovação; zerar a parte tira o campo', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(expPath('p9')).set({ ...newExpenseData(input({ partnerOnlyCents: 500 }), A, CURRENT, ids('p9'), new Date()), status: 'confirmed', everConfirmed: true });
    });
    const data = expenseUpdateData(input({ partnerOnlyCents: 0 }), CURRENT, ids('p9'), { receipt: { type: 'none' }, status: 'confirmed', everConfirmed: true }, serverTime(), removeField());
    await assertFails(db(A).doc(expPath('p9')).update({ ...data, status: 'confirmed' }));
    await assertSucceeds(db(A).doc(expPath('p9')).update(data));
  });
});

describe('marcações dos itens', () => {
  // O formato não é conferido nas regras (informativas; sacrificado para caber no
  // limite de expressões, ajuste c da v0.9.2): o app monta (expenseData.ts).
  it('quem lança grava as marcações com o gasto', async () => {
    await assertSucceeds(create('m1', input({ itemMarks: MARKS })));
    await assertSucceeds(create('m6', input(), { itemMarks: { m: 's'.repeat(990), sig: '0a1b2c3d' } }));
  });

  it('o outro membro não muda as marcações', async () => {
    await assertSucceeds(create('m7', input({ itemMarks: MARKS })));
    await assertFails(db(B).doc(expPath('m7')).update({ ...approvalData(B, serverTime()), itemMarks: { m: 'ppppp', sig: '0a1b2c3d' } }));
  });
});

describe('compra parcelada com as partes', () => {
  type Parcel = ReturnType<typeof newInstallmentSeriesData>[number];
  function series(count: number, firstMonth: string, over: Partial<ExpenseInput> = {}): Parcel[] {
    return newInstallmentSeriesData(
      input({ totalCents: 480000, date: `${firstMonth}-20`, personalCents: 12345, partnerOnlyCents: 67890, ...over }),
      { count, firstMonth },
      A,
      { groupId: GROUP, seriesId: 's1' },
      serverTime(),
    );
  }

  it('as parcelas levam as partes proporcionais; marcações só na parcela 1', async () => {
    const parcels = series(3, CURRENT, { itemMarks: MARKS });
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) batch.set(fs.doc(expPath(p.id)), p.data);
    await assertSucceeds(batch.commit());
  });

  it('a edição da série não muda as partes', async () => {
    const parcels = series(2, CURRENT);
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) batch.set(fs.doc(expPath(p.id)), p.data);
    await assertSucceeds(batch.commit());
    const edit = installmentUpdateData(
      { description: 'Outra descrição', payerUid: A, payerSharePct: 50, receipt: { type: 'none' } },
      { receipt: { type: 'none' }, status: 'pending_approval', partnerOnlyCents: parcels[0].data.partnerOnlyCents },
      { groupId: GROUP, seriesId: 's1' },
      serverTime(),
      removeField(),
    );
    await assertSucceeds(fs.doc(expPath('s1')).update(edit));
    await assertFails(fs.doc(expPath('s1')).update({ ...edit, partnerOnlyCents: 1 }));
  });

  // Medição (seção 2): o lote mais pesado de criação — 48 parcelas começando 6
  // meses atrás (cada mês passado conferido como aberto), com a nota, o
  // registro da nota, os itens lidos no aparelho, a parte do parceiro e as marcações.
  it('48 parcelas começando 6 meses atrás, com nota, itens, partes e marcações, num lote', async () => {
    const first = month(-6);
    const parcels = series(48, first, { receipt: { type: 'nfce', nfceKey: KEY, entry: 'qr' }, itemMarks: MARKS });
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) batch.set(fs.doc(expPath(p.id)), { ...p.data, receipt: { ...p.data.receipt, nfceStatus: 'unchecked' } });
    batch.set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData('s1', A, serverTime()));
    const items = {
      items: [{ description: 'ARROZ 5KG', quantity: 1, unit: 'UN', unitPrice: '25,90', totalCents: 2590 }],
      discountCents: 0,
      totalCents: 2590,
      payments: [],
      itemsSumCents: 2590,
      consistent: true,
    };
    batch.set(fs.doc(`groups/${GROUP}/nfceItems/${KEY}`), deviceItemsData({ items, page: { issuerName: 'LOJA', date: `${first}-20` } }, serverTime()));
    await assertSucceeds(batch.commit());
  });
});
