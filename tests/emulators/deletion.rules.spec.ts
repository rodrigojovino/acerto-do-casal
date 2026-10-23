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
  deletionCancelData,
  deletionDenialData,
  deletionRequestData,
  expenseUpdateData,
  newExpenseData,
  newInstallmentSeriesData,
  validationData,
  type ExpenseInput,
  type ReceiptChoice,
} from '../../src/services/expenseData';
import { createTestEnv } from './setup';

// UIDs fictícios: A e B são o casal, C é um terceiro.
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);
const CLOSED = month(-2);

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();
const photo = (id: string) => ({ type: 'photo', photoPath: `groups/${GROUP}/receipts/${id}.jpg`, photoUploaded: true });

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const path = (id: string) => `groups/${GROUP}/expenses/${id}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();

/** Gasto já gravado (sem regras), de A, no mês atual salvo indicação. */
function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    competence: CURRENT,
    receipt: { type: 'none' },
    status: 'pending_approval',
    createdBy: A,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const pendingReq = (byUid = A) => ({ byUid, at: new Date(), status: 'pending' });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
    await fs.doc(`groups/${GROUP}/months/${CLOSED}`).set({ status: 'closed' });
    // Nunca confirmados: saem direto.
    await fs.doc(path('pendente')).set(base());
    await fs.doc(path('a-confirmar')).set(base({ status: 'awaiting_confirmation', totalCents: 0, recurringId: 'r1' }));
    // Devolvido (contestado depois de confirmado): sai direto.
    await fs.doc(path('devolvido')).set(base({
      status: 'returned', everConfirmed: true, receipt: photo('devolvido'),
      rejection: { byUid: B, at: new Date(), kind: 'contest', reason: 'valor errado' },
    }));
    // Confirmados: só pelo pedido.
    await fs.doc(path('automatico')).set(base({ status: 'confirmed', everConfirmed: true, receipt: photo('automatico') }));
    await fs.doc(path('validado')).set(base({ status: 'confirmed', everConfirmed: true, approval: { byUid: B, at: new Date() } }));
    await fs.doc(path('recorrente')).set(base({ status: 'confirmed', everConfirmed: true, recurringId: 'r2' }));
    // Confirmado e depois editado (voltou para aprovação): continua só pelo pedido.
    await fs.doc(path('editado')).set(base({ status: 'pending_approval', everConfirmed: true }));
    // Confirmado de antes da marca (dados antigos, sem everConfirmed).
    await fs.doc(path('antigo')).set(base({ status: 'confirmed', receipt: photo('antigo') }));
    // Pedido aberto e pedido recusado.
    await fs.doc(path('com-pedido')).set(base({ status: 'confirmed', everConfirmed: true, receipt: photo('com-pedido'), deletionRequest: pendingReq() }));
    await fs.doc(path('recusado')).set(base({
      status: 'confirmed', everConfirmed: true, receipt: photo('recusado'),
      deletionRequest: { ...pendingReq(), status: 'denied', answeredBy: B, answeredAt: new Date() },
    }));
    // Mês fechado, com pedido.
    await fs.doc(path('fechado')).set(base({
      date: `${CLOSED}-10`, competence: CLOSED, status: 'confirmed', everConfirmed: true, deletionRequest: pendingReq(),
    }));
  });
});

const del = (uid: string, id: string) => db(uid).doc(path(id)).delete();
const update = (uid: string, id: string, data: Record<string, unknown>) => db(uid).doc(path(id)).update(data);
const request = (uid: string, id: string, reason?: string) => update(uid, id, deletionRequestData(uid, reason, serverTime()));

describe('exclusão direta por quem lançou', () => {
  it('pendente e "a confirmar" nunca confirmados, e devolvido: saem direto', async () => {
    await assertSucceeds(del(A, 'pendente'));
    await assertSucceeds(del(A, 'a-confirmar'));
    await assertSucceeds(del(A, 'devolvido'));
  });

  it('confirmados (automático, validado, recorrente aprovado, antigo sem a marca) não saem direto', async () => {
    for (const id of ['automatico', 'validado', 'recorrente', 'antigo']) await assertFails(del(A, id));
  });

  it('já confirmado e depois editado (pendente) não sai direto', async () => {
    await assertFails(del(A, 'editado'));
  });

  it('contornar o pedido: editar o aprovado (volta a pendente) e excluir direto é recusado', async () => {
    const input: ExpenseInput = {
      description: 'Mercado do mês', totalCents: 20000, personalCents: 0, payerUid: A, payerSharePct: 50,
      date: `${CURRENT}-05`, receipt: { type: 'none' },
    };
    const data = expenseUpdateData(input, CURRENT, { groupId: GROUP, expenseId: 'validado' }, { receipt: { type: 'none' }, status: 'confirmed', everConfirmed: true }, serverTime(), removeField());
    await assertSucceeds(update(A, 'validado', data));
    await assertFails(del(A, 'validado'));
    // Mesmo sem a marca no documento montado pela edição (a regra a mantém).
    await assertSucceeds(update(A, 'automatico', { description: 'Outro', status: 'pending_approval', updatedAt: serverTime() }));
    await assertFails(del(A, 'automatico'));
  });
});

describe('a marca everConfirmed', () => {
  it('não sai nem vira false pelo app, nem por quem lançou nem pelo outro', async () => {
    await assertFails(update(A, 'editado', { everConfirmed: removeField(), updatedAt: serverTime() }));
    await assertFails(update(A, 'editado', { everConfirmed: false, updatedAt: serverTime() }));
    await assertFails(update(A, 'editado', { description: 'Outro', everConfirmed: removeField(), updatedAt: serverTime() }));
    await assertFails(update(B, 'automatico', { ...validationData(B, serverTime()), everConfirmed: removeField() }));
    await assertFails(update(B, 'editado', { ...approvalData(B, serverTime()), everConfirmed: false }));
  });

  it('é gravada ao confirmar: comprovante na criação, aprovação, validação', async () => {
    const input: ExpenseInput = {
      description: 'Feira', totalCents: 5000, personalCents: 0, payerUid: A, payerSharePct: 50,
      date: `${CURRENT}-05`, receipt: { type: 'photo', replaced: true } as ReceiptChoice,
    };
    await assertSucceeds(db(A).doc(path('nova')).set(newExpenseData(input, A, CURRENT, { groupId: GROUP, expenseId: 'nova' }, serverTime())));
    // Confirmado sem a marca: recusado (criação, aprovação e validação).
    const { everConfirmed: _ignored, ...semMarca } = newExpenseData(input, A, CURRENT, { groupId: GROUP, expenseId: 'nova2' }, serverTime());
    void _ignored;
    await assertFails(db(A).doc(path('nova2')).set(semMarca));
    const { everConfirmed: _a, ...aprovacaoSemMarca } = approvalData(B, serverTime());
    void _a;
    await assertFails(update(B, 'pendente', aprovacaoSemMarca));
    await assertSucceeds(update(B, 'pendente', approvalData(B, serverTime())));
    await assertSucceeds(update(B, 'antigo', validationData(B, serverTime())));
  });

  it('pendente não nasce com a marca', async () => {
    const input: ExpenseInput = {
      description: 'Pão', totalCents: 1000, personalCents: 0, payerUid: A, payerSharePct: 50, date: `${CURRENT}-05`, receipt: { type: 'none' },
    };
    const data = { ...newExpenseData(input, A, CURRENT, { groupId: GROUP, expenseId: 'p2' }, serverTime()), everConfirmed: true };
    await assertFails(db(A).doc(path('p2')).set(data));
  });
});

describe('pedido de exclusão', () => {
  it('quem lançou pede, com ou sem motivo; o gasto continua confirmado', async () => {
    await assertSucceeds(request(A, 'automatico'));
    await assertSucceeds(request(A, 'validado', 'lancei em dobro'));
    await assertSucceeds(request(A, 'editado'));
    await assertSucceeds(request(A, 'antigo'));
  });

  it('não vale para o que sai direto, nem com pedido já aberto', async () => {
    await assertFails(request(A, 'pendente'));
    await assertFails(request(A, 'devolvido'));
    await assertFails(request(A, 'com-pedido'));
  });

  it('depois de uma recusa, pode pedir de novo', async () => {
    await assertSucceeds(request(A, 'recusado', 'agora com o motivo'));
  });

  it('só quem lançou pede, em nome próprio, com horário do servidor e sem mexer em mais nada', async () => {
    await assertFails(request(B, 'automatico'));
    await assertFails(request(C, 'automatico'));
    await assertFails(update(A, 'automatico', deletionRequestData(B, undefined, serverTime())));
    await assertFails(update(A, 'automatico', { deletionRequest: { byUid: A, at: new Date(), status: 'pending' }, updatedAt: serverTime() }));
    await assertFails(update(A, 'automatico', { ...deletionRequestData(A, undefined, serverTime()), description: 'Outro' }));
    await assertFails(update(A, 'automatico', { ...deletionRequestData(A, undefined, serverTime()), status: 'pending_approval' }));
    await assertFails(update(A, 'automatico', { deletionRequest: { byUid: A, at: serverTime(), status: 'denied' }, updatedAt: serverTime() }));
    // Motivo acima de 200 (o app corta; gravado direto, é recusado).
    await assertFails(
      update(A, 'automatico', { deletionRequest: { byUid: A, at: serverTime(), status: 'pending', reason: 'x'.repeat(201) }, updatedAt: serverTime() }),
    );
  });

  it('nada em mês fechado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('fechado2')).set(base({ date: `${CLOSED}-10`, competence: CLOSED, status: 'confirmed', everConfirmed: true }));
    });
    await assertFails(request(A, 'fechado2'));
    await assertFails(del(B, 'fechado'));
    await assertFails(update(B, 'fechado', deletionDenialData(B, serverTime())));
  });
});

describe('resposta ao pedido', () => {
  it('o outro membro aprova excluindo; sem pedido aberto, não exclui', async () => {
    await assertFails(del(B, 'automatico'));
    await assertFails(del(B, 'recusado'));
    await assertFails(del(C, 'com-pedido'));
    await assertSucceeds(del(B, 'com-pedido'));
  });

  it('o outro recusa: o pedido fica recusado, o gasto continua; não mexe no motivo', async () => {
    await assertFails(update(B, 'com-pedido', { 'deletionRequest.reason': 'outro', ...deletionDenialData(B, serverTime()) }));
    await assertFails(update(A, 'com-pedido', deletionDenialData(A, serverTime())));
    await assertSucceeds(update(B, 'com-pedido', deletionDenialData(B, serverTime())));
    await assertFails(del(B, 'com-pedido'));
  });

  it('quem pediu cancela; o outro não cancela (só recusa)', async () => {
    await assertFails(update(B, 'com-pedido', deletionCancelData(serverTime(), removeField())));
    await assertSucceeds(update(A, 'com-pedido', deletionCancelData(serverTime(), removeField())));
    await assertFails(del(B, 'com-pedido'));
  });

  it('com pedido aberto, o outro não valida nem contesta', async () => {
    await assertFails(update(B, 'com-pedido', validationData(B, serverTime())));
    await assertFails(update(B, 'com-pedido', contestData(B, 'valor errado', serverTime(), removeField())));
  });

  it('editar com pedido aberto cancela o pedido; o gasto continua exigindo pedido para sair', async () => {
    // Editar mantendo o pedido: recusado.
    await assertFails(update(A, 'com-pedido', { description: 'Outro', status: 'pending_approval', updatedAt: serverTime() }));
    await assertSucceeds(
      update(A, 'com-pedido', { description: 'Outro', status: 'pending_approval', deletionRequest: removeField(), updatedAt: serverTime() }),
    );
    await assertFails(del(A, 'com-pedido'));
    await assertFails(del(B, 'com-pedido'));
  });
});

describe('série de parcelas', () => {
  it('o pedido vale para as parcelas abertas, num lote; o outro aprova excluindo todas', async () => {
    const input: ExpenseInput = {
      description: 'Geladeira', totalCents: 300000, personalCents: 0, payerUid: A, payerSharePct: 50,
      date: `${CURRENT}-05`, receipt: { type: 'photo', replaced: true },
    };
    const parcels = newInstallmentSeriesData(input, { count: 3, firstMonth: CURRENT }, A, { groupId: GROUP, seriesId: 'serie1' }, serverTime());
    const fsA = db(A);
    const create = fsA.batch();
    for (const p of parcels) create.set(fsA.doc(path(p.id)), p.data);
    await assertSucceeds(create.commit());
    // Confirmadas: a série não sai direto.
    const direct = fsA.batch();
    for (const p of parcels) direct.delete(fsA.doc(path(p.id)));
    await assertFails(direct.commit());
    const req = fsA.batch();
    for (const p of parcels) req.update(fsA.doc(path(p.id)), deletionRequestData(A, 'comprei errado', serverTime()));
    await assertSucceeds(req.commit());
    const fsB = db(B);
    const approve = fsB.batch();
    for (const p of parcels) approve.delete(fsB.doc(path(p.id)));
    await assertSucceeds(approve.commit());
  });
});
