import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  approvalData,
  contestData,
  installmentUpdateData,
  newInstallmentSeriesData,
  rejectionData,
  validationData,
  type ExpenseInput,
} from '../../src/services/expenseData';
import { seriesTargets } from '../../src/services/series';
import { SEFAZ_SP_CANONICAL, checkDigit } from '../../functions/src/nfce';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// UIDs fictícios: A e B são o casal, C é um terceiro.
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';

// Meses relativos a hoje (UTC, como as regras), para os testes não envelhecerem.
function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);
const NEXT = month(1);
const TOO_FAR = month(2);

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();

const purchase: ExpenseInput = {
  description: 'Geladeira',
  totalCents: 214000,
  personalCents: 0,
  payerUid: A,
  payerSharePct: 50,
  date: `${CURRENT}-05`,
  receipt: { type: 'none' },
};

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});

afterAll(async () => {
  await env.cleanup();
});

const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  });
});

type Parcel = ReturnType<typeof newInstallmentSeriesData>[number];

/** Série como o app monta (horários do servidor). */
function series(input: Partial<ExpenseInput> = {}, count = 10, firstMonth = CURRENT, seriesId = 'serie1', uid = A): Parcel[] {
  return newInstallmentSeriesData({ ...purchase, ...input }, { count, firstMonth }, uid, { groupId: GROUP, seriesId }, serverTime());
}

/** Grava a série num lote, como o app (offline, um único envio). */
function createBatch(uid: string, parcels: Array<{ id: string; data: Record<string, unknown> }>) {
  const fs = db(uid);
  const batch = fs.batch();
  for (const p of parcels) batch.set(fs.doc(expPath(p.id)), p.data);
  return batch.commit();
}

/** Semeia a série já gravada (sem regras), com status/aprovação opcionais. */
async function seedSeries(parcels: Parcel[], extra: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const batch = ctx.firestore().batch();
    for (const p of parcels) {
      batch.set(ctx.firestore().doc(expPath(p.id)), { ...p.data, createdAt: new Date(), updatedAt: new Date(), ...extra });
    }
    await batch.commit();
  });
}

/** Parcelas como o app as vê (para escolher quais uma ação atinge). */
function asParcels(parcels: Parcel[], extra: { status?: string; approval?: { byUid: string } } = {}) {
  return parcels.map((p) => ({
    id: p.id,
    competence: p.data.competence,
    status: (extra.status ?? p.data.status) as 'confirmed' | 'pending_approval',
    approval: extra.approval,
    createdBy: p.data.createdBy,
    installment: p.data.installment,
  }));
}

function updateBatch(uid: string, ids: string[], data: Record<string, unknown>) {
  const fs = db(uid);
  const batch = fs.batch();
  for (const id of ids) batch.update(fs.doc(expPath(id)), data);
  return batch.commit();
}

describe('lançar a série', () => {
  it('sem comprovante: todas as parcelas pendentes, num lote', async () => {
    const parcels = series();
    if (parcels.some((p) => p.data.status !== 'pending_approval')) throw new Error('deveria nascer pendente');
    await assertSucceeds(createBatch(A, parcels));
  });

  it('48 parcelas a partir do mês seguinte, num lote (cabe no limite de leituras das regras)', async () => {
    await assertSucceeds(createBatch(A, series({}, 48, NEXT)));
  });

  it('compra no mês atual com a primeira parcela na fatura do mês seguinte (10x)', async () => {
    const parcels = series({}, 10, NEXT);
    if (parcels[0].data.competence !== NEXT || parcels[9].data.competence !== month(10)) throw new Error('meses das parcelas');
    if (!parcels[0].data.date.startsWith(NEXT)) throw new Error('data da parcela 1 no mês seguinte');
    await assertSucceeds(createBatch(A, parcels));
  });

  it('primeira parcela em mês passado (meses passados abertos)', async () => {
    await assertSucceeds(createBatch(A, series({ date: `${month(-3)}-20` }, 12, month(-3))));
  });

  it('48 parcelas começando 6 meses atrás (o mais antigo que o app permite), num lote', async () => {
    await assertSucceeds(createBatch(A, series({ date: `${month(-6)}-20` }, 48, month(-6))));
  });

  it('com foto: todas confirmadas, a foto no caminho da série', async () => {
    const parcels = series({ receipt: { type: 'photo', replaced: true } });
    if (parcels.some((p) => p.data.status !== 'confirmed')) throw new Error('deveria nascer confirmado');
    await assertSucceeds(createBatch(A, parcels));
  });

  it('foto no caminho da própria parcela (fora da série) é recusada', async () => {
    const parcels = series({ receipt: { type: 'photo', replaced: true } }, 3);
    const wrong = { ...parcels[1], data: { ...parcels[1].data, receipt: { type: 'photo', photoPath: `groups/${GROUP}/receipts/${parcels[1].id}.jpg`, photoUploaded: false } } };
    await assertFails(createBatch(A, [parcels[0], wrong, parcels[2]]));
  });

  it('parcela futura sozinha (sem a parcela 1 da série) é recusada', async () => {
    const parcels = series({}, 10);
    await assertFails(createBatch(A, [parcels[9]]));
    await assertFails(createBatch(A, parcels.slice(1)));
  });

  it('parcela 1 de outra série, de outro autor ou com outro número de parcelas não vale', async () => {
    const mine = series({}, 10);
    const other = series({}, 12);
    await assertFails(createBatch(A, [mine[0], other[5]])); // 12x contra parcela 1 de 10x
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(expPath('serie1')).set({ ...series({ payerUid: B }, 10, CURRENT, 'serie1', B)[0].data, createdAt: new Date(), updatedAt: new Date() });
    });
    await assertFails(createBatch(A, [mine[4]])); // parcela 1 existe, mas é de B
  });

  it('valor de cada parcela tem de bater com o total da compra (resto na primeira)', async () => {
    const parcels = series({ totalCents: 100005 }, 10);
    const withTotal = (i: number, totalCents: number) => ({ ...parcels[i], data: { ...parcels[i].data, totalCents } });
    await assertFails(createBatch(A, [withTotal(0, 10000), ...parcels.slice(1)])); // resto fora da primeira
    await assertFails(createBatch(A, [parcels[0], withTotal(1, 10005), ...parcels.slice(2)]));
    const otherPurchase = parcels.map((p) => ({ ...p, data: { ...p.data, installment: { ...p.data.installment, purchaseCents: 200000 } } }));
    await assertFails(createBatch(A, otherPurchase));
    await assertSucceeds(createBatch(A, parcels));
  });

  it('id, competência e limites da série são conferidos', async () => {
    const parcels = series({}, 10);
    const tamper = (i: number, patch: Record<string, unknown>, id = parcels[i].id) => [
      parcels[0],
      { id, data: { ...parcels[i].data, ...patch } },
    ];
    await assertFails(createBatch(A, tamper(3, {}, 'serie1-x'))); // id fora do padrão
    await assertFails(createBatch(A, tamper(3, { competence: CURRENT, date: `${CURRENT}-05` }))); // mês não é o do índice
    const count49 = series({}, 3).map((p) => ({ ...p, data: { ...p.data, installment: { ...p.data.installment, count: 49 } } }));
    await assertFails(createBatch(A, count49));
    await assertFails(createBatch(A, series({ date: `${TOO_FAR}-05` }, 3, TOO_FAR))); // primeiro mês além do limite
    await assertFails(createBatch(B, series()));
    await assertFails(createBatch(C, series({ payerUid: C }, 3, CURRENT, 'serie1', C)));
  });
});

describe('aprovação e contestação valem para a série', () => {
  it('sem comprovante: o outro aprova a série inteira de uma vez', async () => {
    const parcels = series({}, 6);
    await seedSeries(parcels);
    const ids = seriesTargets(asParcels(parcels), 'approve', B, new Set()).map((p) => p.id);
    if (ids.length !== 6) throw new Error('deveria aprovar as 6');
    await assertSucceeds(updateBatch(B, ids, approvalData(B, serverTime())));
  });

  it('recusar uma parcela recusa a série', async () => {
    const parcels = series({}, 6);
    await seedSeries(parcels);
    const ids = seriesTargets(asParcels(parcels), 'reject', B, new Set()).map((p) => p.id);
    await assertSucceeds(updateBatch(B, ids, rejectionData(B, 'Não foi 50/50', serverTime())));
  });

  it('contestar uma parcela contesta a série inteira num lote', async () => {
    const parcels = series({ receipt: { type: 'photo', replaced: true } }, 6);
    await seedSeries(parcels);
    const ids = seriesTargets(asParcels(parcels), 'contest', B, new Set()).map((p) => p.id);
    if (ids.length !== 6) throw new Error('deveria contestar as 6');
    await assertSucceeds(updateBatch(B, ids, contestData(B, 'Compra não combinada', serverTime(), removeField())));
  });

  it('validar uma parcela valida a série', async () => {
    const parcels = series({ receipt: { type: 'photo', replaced: true } }, 6);
    await seedSeries(parcels);
    const ids = seriesTargets(asParcels(parcels), 'validate', B, new Set()).map((p) => p.id);
    await assertSucceeds(updateBatch(B, ids, validationData(B, serverTime())));
  });

  it('quem lançou não aprova a própria série; parcela de mês fechado fica de fora', async () => {
    const parcels = series({ date: `${month(-1)}-05` }, 4, month(-1));
    await seedSeries(parcels);
    await assertFails(updateBatch(A, parcels.map((p) => p.id), approvalData(A, serverTime())));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}/months/${month(-1)}`).set({ status: 'closed' });
    });
    const targets = seriesTargets(asParcels(parcels), 'approve', B, new Set([month(-1)]));
    if (targets.some((p) => p.competence === month(-1))) throw new Error('mês fechado deveria ficar de fora');
    await assertSucceeds(updateBatch(B, targets.map((p) => p.id), approvalData(B, serverTime())));
    await assertFails(updateBatch(B, [parcels[0].id], approvalData(B, serverTime())));
  });
});

describe('edição da série', () => {
  it('descrição, quem pagou e divisão em todas as parcelas; confirmada volta para pendente', async () => {
    const parcels = series({ receipt: { type: 'photo', replaced: true } }, 5);
    await seedSeries(parcels, { approval: { byUid: B, at: new Date() } });
    const edit = { description: 'Geladeira nova', payerUid: B, payerSharePct: 60, receipt: { type: 'photo' as const, replaced: false } };
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) {
      const data = installmentUpdateData(edit, { receipt: p.data.receipt, status: 'confirmed' }, { groupId: GROUP, seriesId: 'serie1' }, serverTime(), removeField());
      if (data.status !== 'pending_approval') throw new Error('confirmada editada deveria voltar para pendente');
      batch.update(fs.doc(expPath(p.id)), data);
    }
    await assertSucceeds(batch.commit());
  });

  it('observação é da série: lançada em todas as parcelas e trocada pela edição da série', async () => {
    const parcels = series({ note: 'geladeira nova da cozinha' }, 3);
    if (parcels.some((p) => p.data.note !== 'geladeira nova da cozinha')) throw new Error('observação deveria ir em todas');
    await assertSucceeds(createBatch(A, parcels));
    const fs = db(A);
    const batch = fs.batch();
    const edit = { description: 'Geladeira', note: 'com frete', payerUid: A, payerSharePct: 50, receipt: { type: 'none' as const } };
    for (const p of parcels) {
      batch.update(fs.doc(expPath(p.id)), installmentUpdateData(edit, { receipt: p.data.receipt, status: 'pending_approval' }, { groupId: GROUP, seriesId: 'serie1' }, serverTime(), removeField()));
    }
    await assertSucceeds(batch.commit());
  });

  it('pendente + anexar comprovante confirma a série', async () => {
    const parcels = series({}, 3);
    await seedSeries(parcels);
    const edit = { description: 'Geladeira', payerUid: A, payerSharePct: 50, receipt: { type: 'photo' as const, replaced: true } };
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) {
      const data = installmentUpdateData(edit, { receipt: p.data.receipt, status: 'pending_approval' }, { groupId: GROUP, seriesId: 'serie1' }, serverTime(), removeField());
      if (data.status !== 'confirmed') throw new Error('deveria confirmar');
      batch.update(fs.doc(expPath(p.id)), data);
    }
    await assertSucceeds(batch.commit());
  });

  it('valor, parte pessoal, data, competência e a série não mudam na edição', async () => {
    const parcels = series({}, 3);
    await seedSeries(parcels);
    const ref = db(A).doc(expPath('serie1-2'));
    const base = { status: 'pending_approval', updatedAt: serverTime() };
    await assertFails(ref.update({ ...base, totalCents: 1 }));
    await assertFails(ref.update({ ...base, personalCents: 1 }));
    await assertFails(ref.update({ ...base, date: `${NEXT}-06` }));
    await assertFails(ref.update({ ...base, 'installment.count': 2 }));
    await assertFails(ref.update({ ...base, installment: removeField() }));
    await assertSucceeds(ref.update({ ...base, description: 'Geladeira (frete incluso)' }));
  });

  it('só quem lançou exclui; a série sai num lote', async () => {
    const parcels = series({}, 4);
    await seedSeries(parcels);
    const del = (uid: string) => {
      const fs = db(uid);
      const batch = fs.batch();
      for (const p of parcels) batch.delete(fs.doc(expPath(p.id)));
      return batch.commit();
    };
    await assertFails(del(B));
    await assertSucceeds(del(A));
  });
});

describe('nova consulta da NFC-e ("Consultar de novo")', () => {
  const keyFor = (ufCode: string) => {
    const base = `${ufCode}26101122233300018165001000000123112345678`;
    return base + checkDigit(base);
  };
  const KEY = keyFor('35');
  const URL = `${SEFAZ_SP_CANONICAL}${KEY}|2|1|1|${'A'.repeat(40)}`;
  const failed = { type: 'nfce', nfceKey: KEY, nfceUrl: URL, nfceStatus: 'failed', nfceError: 'network' };
  const retry = { receipt: { type: 'nfce', nfceKey: KEY, nfceUrl: URL, nfceStatus: 'pending' }, updatedAt: serverTime() };

  async function seedOne(receipt: Record<string, unknown>, status = 'confirmed') {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(expPath('nota')).set({
        description: 'Mercado',
        totalCents: 20000,
        personalCents: 0,
        payerUid: A,
        payerSharePct: 50,
        date: `${CURRENT}-05`,
        competence: CURRENT,
        receipt,
        status,
        createdBy: A,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }

  it('quem lançou volta uma consulta que falhou para pendente, sem mudar o status', async () => {
    await seedOne(failed);
    await assertSucceeds(db(A).doc(expPath('nota')).update(retry));
  });

  it('não vale para nota já conferida nem para o outro membro', async () => {
    await seedOne({ ...failed, nfceStatus: 'ok' });
    await assertFails(db(A).doc(expPath('nota')).update(retry));
    await seedOne(failed);
    await assertFails(db(B).doc(expPath('nota')).update(retry));
    // Mudar também o status é uma edição comum (confirmado editado vai para pendente), não a nova consulta.
    await assertFails(db(A).doc(expPath('nota')).update({ ...retry, status: 'returned' }));
  });
});
