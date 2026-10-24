import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  categoryActiveData,
  categoryOrderData,
  categoryRenameData,
  newCategoryData,
  requireCategoryData,
} from '../../src/services/categoryData';
import {
  approvalData,
  expenseUpdateData,
  newExpenseData,
  newInstallmentSeriesData,
  type ExpenseInput,
} from '../../src/services/expenseData';
import { newRecurringData, recurringUpdateData, type RecurringInput } from '../../src/services/recurringData';
import { createTestEnv } from './setup';

// Categorias: compartilhadas pelo casal, nunca apagadas; exigência no grupo.
// UIDs fictícios: A e B são o casal, C é um terceiro (com o próprio grupo).
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';
const OTHER_GROUP = 'group-2';

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const catPath = (id: string, group = GROUP) => `groups/${group}/categories/${id}`;
const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const recPath = (id: string) => `groups/${GROUP}/recurring/${id}`;
const ids = (expenseId: string) => ({ groupId: GROUP, expenseId });

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(clean);
  });
}

const storedCategory = (name: string, active = true, order = 0) => ({ name, active, order, createdBy: A, createdAt: new Date(), updatedAt: new Date() });

function input(extra: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    receipt: { type: 'none' },
    ...extra,
  };
}

const create = (uid: string, id: string, data: Record<string, unknown>) => db(uid).doc(expPath(id)).set(data);

beforeEach(async () => {
  await env.clearFirestore();
  await seed(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  await seed(`groups/${OTHER_GROUP}`, { members: [C], memberNames: { [C]: 'Pessoa C' }, defaultSplitPct: 50 });
  await seed(catPath('mercado'), storedCategory('Mercado'));
  await seed(catPath('antiga'), storedCategory('Antiga', false));
  await seed(catPath('dele', OTHER_GROUP), { ...storedCategory('De outro grupo'), createdBy: C });
});

describe('cadastro de categorias', () => {
  it('qualquer membro cria; terceiro não lê nem cria', async () => {
    await assertSucceeds(db(A).doc(catPath('c1')).set(newCategoryData('Saúde', 0, A, serverTime())));
    await assertSucceeds(db(B).doc(catPath('c2')).set(newCategoryData('Lazer', 0, B, serverTime())));
    await assertFails(db(C).doc(catPath('c3')).set(newCategoryData('Invasão', 0, C, serverTime())));
    await assertFails(db(C).doc(catPath('mercado')).get());
    await assertSucceeds(db(B).doc(catPath('mercado')).get());
  });

  it('criação adulterada: nome vazio ou longo, desativada, autor trocado, campo a mais, id inválido', async () => {
    const ok = newCategoryData('Saúde', 0, A, serverTime());
    await assertFails(db(A).doc(catPath('x1')).set({ ...ok, name: '   ' }));
    await assertFails(db(A).doc(catPath('x2')).set({ ...ok, name: 'x'.repeat(41) }));
    await assertFails(db(A).doc(catPath('x3')).set({ ...ok, active: false }));
    await assertFails(db(A).doc(catPath('x4')).set({ ...ok, createdBy: B }));
    await assertFails(db(A).doc(catPath('x5')).set({ ...ok, color: 'azul' }));
    await assertFails(db(A).doc(catPath('x-6')).set(ok));
  });

  it('renomeia, desativa e reativa (qualquer membro); nome vazio e autoria não mudam', async () => {
    await assertSucceeds(db(B).doc(catPath('mercado')).update(categoryRenameData('Supermercado', serverTime())));
    await assertSucceeds(db(B).doc(catPath('mercado')).update(categoryActiveData(false, serverTime())));
    await assertSucceeds(db(A).doc(catPath('mercado')).update(categoryActiveData(true, serverTime())));
    await assertFails(db(A).doc(catPath('mercado')).update(categoryRenameData('  ', serverTime())));
    await assertFails(db(A).doc(catPath('mercado')).update({ createdBy: B, updatedAt: serverTime() }));
    await assertFails(db(A).doc(catPath('mercado')).update({ active: 'sim', updatedAt: serverTime() }));
    await assertFails(db(C).doc(catPath('mercado')).update(categoryActiveData(false, serverTime())));
  });

  it('ordem na criação: inteiro de 0 a 9999, obrigatória', async () => {
    const ok = newCategoryData('Saúde', 3, A, serverTime());
    await assertSucceeds(db(A).doc(catPath('o1')).set(ok));
    await assertFails(db(A).doc(catPath('o2')).set({ ...ok, order: -1 }));
    await assertFails(db(A).doc(catPath('o3')).set({ ...ok, order: 10000 }));
    await assertFails(db(A).doc(catPath('o4')).set({ ...ok, order: 1.5 }));
    const { order: _order, ...withoutOrder } = ok;
    void _order;
    await assertFails(db(A).doc(catPath('o5')).set(withoutOrder));
  });

  it('reordenar: os dois membros, num lote; terceiro não; posição inválida não', async () => {
    await seed(catPath('saude'), storedCategory('Saúde', true, 1));
    for (const uid of [A, B]) {
      const fs = db(uid);
      await assertSucceeds(
        fs.batch()
          .update(fs.doc(catPath('saude')), categoryOrderData(0, serverTime()))
          .update(fs.doc(catPath('mercado')), categoryOrderData(1, serverTime()))
          .commit(),
      );
    }
    const outsider = db(C);
    await assertFails(
      outsider.batch()
        .update(outsider.doc(catPath('saude')), categoryOrderData(1, serverTime()))
        .update(outsider.doc(catPath('mercado')), categoryOrderData(0, serverTime()))
        .commit(),
    );
    await assertFails(db(C).doc(catPath('saude')).update(categoryOrderData(5, serverTime())));
    await assertFails(db(A).doc(catPath('saude')).update(categoryOrderData(-2, serverTime())));
    await assertFails(db(A).doc(catPath('saude')).update({ order: '1', updatedAt: serverTime() }));
  });

  it('nunca é apagada, nem por quem criou', async () => {
    await assertFails(db(A).doc(catPath('mercado')).delete());
    await assertFails(db(A).doc(catPath('antiga')).delete());
  });
});

describe('exigir categoria nos gastos (grupo)', () => {
  it('qualquer membro liga e desliga; só booleano; terceiro não', async () => {
    await assertSucceeds(db(B).doc(`groups/${GROUP}`).update(requireCategoryData(true)));
    await assertSucceeds(db(A).doc(`groups/${GROUP}`).update(requireCategoryData(false)));
    await assertFails(db(A).doc(`groups/${GROUP}`).update({ requireCategory: 'sim' }));
    await assertFails(db(C).doc(`groups/${GROUP}`).update(requireCategoryData(true)));
  });

  it('ligada: gasto novo sem categoria é recusado; com categoria passa', async () => {
    await seed(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50, requireCategory: true });
    await assertFails(create(A, 'e1', newExpenseData(input(), A, CURRENT, ids('e1'), serverTime())));
    await assertSucceeds(create(A, 'e2', newExpenseData(input({ categoryId: 'mercado' }), A, CURRENT, ids('e2'), serverTime())));
  });

  it('ligada: gasto antigo sem categoria continua editável', async () => {
    await assertSucceeds(create(A, 'e1', newExpenseData(input(), A, CURRENT, ids('e1'), serverTime())));
    await seed(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50, requireCategory: true });
    const current = { receipt: { type: 'none' as const }, status: 'pending_approval' as const };
    await assertSucceeds(db(A).doc(expPath('e1')).update(expenseUpdateData(input({ description: 'Feira' }), CURRENT, ids('e1'), current, serverTime(), removeField())));
  });
});

describe('categoria no gasto', () => {
  it('só categoria existente e ativa do próprio grupo, com id válido', async () => {
    const data = (id: string, categoryId: string) => newExpenseData(input({ categoryId }), A, CURRENT, ids(id), serverTime());
    await assertSucceeds(create(A, 'e1', data('e1', 'mercado')));
    await assertFails(create(A, 'e2', data('e2', 'naoexiste')));
    await assertFails(create(A, 'e3', data('e3', 'antiga')));
    await assertFails(create(A, 'e4', data('e4', 'dele')));
    await assertFails(create(A, 'e5', { ...data('e5', 'mercado'), categoryId: 42 }));
  });

  it('categoria criada no mesmo lote do gasto vale', async () => {
    const fs = db(A);
    const batch = fs.batch()
      .set(fs.doc(catPath('nova')), newCategoryData('Nova', 0, A, serverTime()))
      .set(fs.doc(expPath('e1')), newExpenseData(input({ categoryId: 'nova' }), A, CURRENT, ids('e1'), serverTime()));
    await assertSucceeds(batch.commit());
  });

  it('manter uma categoria que foi desativada vale; trocar para uma desativada, não', async () => {
    await assertSucceeds(create(A, 'e1', newExpenseData(input({ categoryId: 'mercado' }), A, CURRENT, ids('e1'), serverTime())));
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(catPath('mercado')).update({ active: false }));
    const current = { receipt: { type: 'none' as const }, status: 'pending_approval' as const };
    const edit = (categoryId?: string) =>
      db(A).doc(expPath('e1')).update(expenseUpdateData(input({ description: 'Feira', categoryId }), CURRENT, ids('e1'), current, serverTime(), removeField()));
    await assertSucceeds(edit('mercado'));
    await assertFails(edit('antiga'));
    await assertSucceeds(edit(undefined));
  });

  it('trocar a categoria de um confirmado volta para aprovação; mantendo confirmado é recusado', async () => {
    const photo = { type: 'photo' as const, replaced: true };
    const data = newExpenseData(input({ receipt: photo, categoryId: 'mercado' }), A, CURRENT, ids('e1'), serverTime());
    expect(data.status).toBe('confirmed');
    await assertSucceeds(create(A, 'e1', data));
    await seed(catPath('saude'), storedCategory('Saúde'));
    const current = { receipt: { type: 'photo' as const, photoPath: `groups/${GROUP}/receipts/e1.jpg`, photoUploaded: false }, status: 'confirmed' as const, everConfirmed: true };
    const change = expenseUpdateData(input({ receipt: { type: 'photo', replaced: false }, categoryId: 'saude' }), CURRENT, ids('e1'), current, serverTime(), removeField());
    expect(change.status).toBe('pending_approval');
    await assertFails(db(A).doc(expPath('e1')).update({ categoryId: 'saude', updatedAt: serverTime() }));
    await assertSucceeds(db(A).doc(expPath('e1')).update(change));
  });

  it('o outro membro não troca a categoria ao aprovar', async () => {
    await assertSucceeds(create(A, 'e1', newExpenseData(input({ categoryId: 'mercado' }), A, CURRENT, ids('e1'), serverTime())));
    await seed(catPath('saude'), storedCategory('Saúde'));
    await assertFails(db(B).doc(expPath('e1')).update({ ...approvalData(B, serverTime()), categoryId: 'saude' }));
    await assertSucceeds(db(B).doc(expPath('e1')).update(approvalData(B, serverTime())));
  });
});

describe('categoria na série', () => {
  const choice = { count: 3, firstMonth: CURRENT };

  it('todas as parcelas com a mesma categoria passam', async () => {
    const fs = db(A);
    const batch = fs.batch();
    for (const p of newInstallmentSeriesData(input({ categoryId: 'mercado' }), choice, A, { groupId: GROUP, seriesId: 's1' }, serverTime())) {
      batch.set(fs.doc(expPath(p.id)), p.data);
    }
    await assertSucceeds(batch.commit());
  });

  it('série de 48 parcelas com categoria cabe no limite de leituras das regras', async () => {
    const fs = db(A);
    const batch = fs.batch();
    for (const p of newInstallmentSeriesData(input({ totalCents: 480000, categoryId: 'mercado' }), { count: 48, firstMonth: CURRENT }, A, { groupId: GROUP, seriesId: 's48' }, serverTime())) {
      batch.set(fs.doc(expPath(p.id)), p.data);
    }
    await assertSucceeds(batch.commit());
  });

  it('parcela com categoria diferente da parcela 1 é recusada', async () => {
    await seed(catPath('saude'), storedCategory('Saúde'));
    const fs = db(A);
    const batch = fs.batch();
    const parcels = newInstallmentSeriesData(input({ categoryId: 'mercado' }), choice, A, { groupId: GROUP, seriesId: 's1' }, serverTime());
    parcels.forEach((p, i) => batch.set(fs.doc(expPath(p.id)), i === 2 ? { ...p.data, categoryId: 'saude' } : p.data));
    await assertFails(batch.commit());
  });
});

describe('categoria no recorrente', () => {
  const fixed: RecurringInput = {
    description: 'Internet',
    kind: 'fixed',
    amountCents: 12000,
    dayOfMonth: 10,
    payerUid: A,
    payerSharePct: 50,
    startMonth: CURRENT,
  };

  it('cadastro com categoria ativa passa; desativada ou inexistente, não', async () => {
    await assertSucceeds(db(A).doc(recPath('r1')).set(newRecurringData({ ...fixed, categoryId: 'mercado' }, A, serverTime())));
    await assertFails(db(A).doc(recPath('r2')).set(newRecurringData({ ...fixed, categoryId: 'antiga' }, A, serverTime())));
    await assertFails(db(A).doc(recPath('r3')).set(newRecurringData({ ...fixed, categoryId: 'naoexiste' }, A, serverTime())));
  });

  it('aprovado: quem cadastrou troca a categoria direto, sem reajuste; o outro membro não', async () => {
    await seed(recPath('r1'), { ...fixed, categoryId: 'mercado', active: true, status: 'approved', approval: { byUid: B, at: new Date() }, createdBy: A, createdAt: new Date(), updatedAt: new Date() });
    await seed(catPath('casa'), storedCategory('Casa'));
    const current = { ...fixed, status: 'approved' as const };
    const data = recurringUpdateData({ ...fixed, categoryId: 'casa' }, current, true, serverTime(), removeField());
    await assertFails(db(B).doc(recPath('r1')).update({ categoryId: 'casa', updatedAt: serverTime() }));
    await assertSucceeds(db(A).doc(recPath('r1')).update(data));
  });
});
