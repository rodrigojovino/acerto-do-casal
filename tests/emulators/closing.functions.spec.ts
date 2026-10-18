import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseError } from 'firebase/app';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monthOf, todayInSaoPaulo } from '../../src/domain/calendar';
import { addMonths } from '../../src/domain/settlement';
import { PROJECT_ID, clearAuth, closeApps, createTestEnv, signInAs, type TestUser } from './setup';

// Fechamento, pagamento do acerto e reabertura (Functions no emulador), com
// usuários fictícios logados no emulador de Auth.

const GROUP = 'grupoTeste01';
const CURRENT = monthOf(todayInSaoPaulo());
const PAST = addMonths(CURRENT, -1);
const FUTURE = addMonths(CURRENT, 1);

let env: RulesTestEnvironment;
let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await clearAuth();
  a = await signInAs('ana', 'Pessoa A');
  b = await signInAs('bia', 'Pessoa B');
  await write(`groups/${GROUP}`, { members: [a.uid, b.uid], memberNames: { [a.uid]: 'Pessoa A', [b.uid]: 'Pessoa B' } });
});

afterEach(async () => {
  await closeApps();
});

async function write(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

async function read(path: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(path).get()).data();
  });
  return data;
}

let seq = 0;
/** Gasto do mês, como o app grava (só o que o fechamento usa importa aqui). */
async function expense(month: string, payer: TestUser, totalCents: number, overrides: Record<string, unknown> = {}) {
  const id = `g${++seq}`;
  await write(`groups/${GROUP}/expenses/${id}`, {
    description: 'Gasto',
    totalCents,
    personalCents: 0,
    payerUid: payer.uid,
    payerSharePct: 50,
    date: `${month}-10`,
    competence: month,
    receipt: { type: 'none' },
    status: 'confirmed',
    createdBy: payer.uid,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return id;
}

async function expectError(promise: Promise<unknown>, code: string, message?: RegExp): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, 'era esperado um erro').toBeInstanceOf(FirebaseError);
  expect((err as FirebaseError).code).toBe(`functions/${code}`);
  if (message) expect((err as FirebaseError).message).toMatch(message);
}

const args = (month: string, extra: Record<string, unknown> = {}) => ({ groupId: GROUP, month, ...extra });
const monthDoc = (month: string) => read(`groups/${GROUP}/months/${month}`);
let pid = 0;
const paymentId = () => `pagamento${String(++pid).padStart(4, '0')}`;

describe('fechar', () => {
  it('saldo zero fecha sem pagamento e guarda a memória de cálculo', async () => {
    await expense(PAST, a, 10000);
    await expense(PAST, b, 10000);
    await b.call('closeMonth', args(PAST));
    const m = await monthDoc(PAST);
    expect(m).toMatchObject({ status: 'closed', closedBy: b.uid, summary: { totalCents: 20000, sharedCents: 20000, result: null } });
  });

  it('com pendência, devolvido, recorrente a confirmar ou foto não enviada é recusado', async () => {
    await expense(PAST, a, 10000, { status: 'pending_approval' });
    await expense(PAST, a, 10000, { receipt: { type: 'photo', photoPath: 'x', photoUploaded: false } });
    await expectError(a.call('closeMonth', args(PAST)), 'failed-precondition', /1 gasto pendente de aprovação, 1 foto de comprovante não enviada/);
    expect((await monthDoc(PAST))?.status).toBeUndefined();
  });

  it('mês futuro nunca fecha; o mês atual pode fechar', async () => {
    await expectError(a.call('closeMonth', args(FUTURE)), 'failed-precondition', /futuro/);
    await a.call('closeMonth', args(CURRENT));
    expect((await monthDoc(CURRENT))?.status).toBe('closed');
  });

  it('terceiro não fecha; mês já fechado não fecha de novo', async () => {
    const c = await signInAs('cris', 'Pessoa C');
    await expectError(c.call('closeMonth', args(PAST)), 'permission-denied');
    await a.call('closeMonth', args(PAST));
    await expectError(b.call('closeMonth', args(PAST)), 'failed-precondition', /já está fechado/);
  });

  it('com saldo, falta o pagamento; só quem paga registra; pago, fecha', async () => {
    await expense(PAST, b, 20000); // A deve R$ 100,00 a B
    await expectError(a.call('closeMonth', args(PAST)), 'failed-precondition', /pagamento de R\$\s?100,00/);
    await expectError(b.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() })), 'permission-denied');
    const payment = await a.call<{ fromUid: string; amountCents: number }>('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() }));
    expect(payment).toMatchObject({ fromUid: a.uid, amountCents: 10000 });
    await expectError(a.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() })), 'failed-precondition', /nada a pagar/);
    await b.call('closeMonth', args(PAST));
    expect(await monthDoc(PAST)).toMatchObject({ status: 'closed', payments: [{ fromUid: a.uid, toUid: b.uid, amountCents: 10000, method: 'cash', byUid: a.uid }] });
  });

  it('PIX exige a foto do comprovante já enviada', async () => {
    await expense(PAST, b, 20000);
    const id = paymentId();
    await expectError(a.call('registerPayment', args(PAST, { method: 'pix', paymentId: id })), 'failed-precondition', /foto/);
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Bucket padrão das Functions no emulador (o do pacote de testes é outro).
      await ctx
        .storage(`gs://${PROJECT_ID}.appspot.com`)
        .ref(`groups/${GROUP}/settlements/${PAST}/${id}.jpg`)
        .put(new Uint8Array(512), { contentType: 'image/jpeg' });
    });
    const payment = await a.call<{ receiptPath: string }>('registerPayment', args(PAST, { method: 'pix', paymentId: id }));
    expect(payment.receiptPath).toBe(`groups/${GROUP}/settlements/${PAST}/${id}.jpg`);
  });
});

describe('reabrir', () => {
  beforeEach(async () => {
    await expense(PAST, b, 20000);
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() }));
    await a.call('closeMonth', args(PAST));
  });

  it('o pedido não reabre; quem pediu não aprova; o outro aprova e o mês volta a aberto', async () => {
    await expectError(a.call('requestReopen', args(PAST, { reason: '  ' })), 'invalid-argument', /motivo/);
    await a.call('requestReopen', args(PAST, { reason: 'Faltou a farmácia' }));
    expect(await monthDoc(PAST)).toMatchObject({ status: 'closed', reopenRequest: { byUid: a.uid, reason: 'Faltou a farmácia', status: 'pending' } });
    await expectError(a.call('answerReopen', args(PAST, { approve: true })), 'permission-denied', /próprio pedido/);
    await expectError(a.call('requestReopen', args(PAST, { reason: 'De novo' })), 'already-exists');
    await b.call('answerReopen', args(PAST, { approve: true }));
    const m = await monthDoc(PAST);
    expect(m).toMatchObject({ status: 'open', reopenRequest: { status: 'approved', answeredBy: b.uid } });
    expect(m?.summary).toBeUndefined();
    expect(m?.payments).toHaveLength(1); // os pagamentos continuam valendo
  });

  it('recusado, continua fechado; quem pediu pode cancelar', async () => {
    await b.call('requestReopen', args(PAST, { reason: 'Conferir a luz' }));
    await a.call('answerReopen', args(PAST, { approve: false }));
    expect(await monthDoc(PAST)).toMatchObject({ status: 'closed', reopenRequest: { status: 'denied' } });
    await b.call('requestReopen', args(PAST, { reason: 'Conferir a luz de novo' }));
    await expectError(a.call('cancelReopen', args(PAST)), 'failed-precondition');
    await b.call('cancelReopen', args(PAST));
    expect((await monthDoc(PAST))?.reopenRequest).toBeUndefined();
  });

  it('fechar, reabrir, incluir gasto, pagar só a diferença, fechar', async () => {
    await a.call('requestReopen', args(PAST, { reason: 'Faltou um gasto' }));
    await b.call('answerReopen', args(PAST, { approve: true }));
    await expense(PAST, b, 6000); // A passa a dever mais R$ 30,00
    await expectError(a.call('closeMonth', args(PAST)), 'failed-precondition', /R\$\s?30,00/);
    const diff = await a.call<{ amountCents: number }>('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() }));
    expect(diff.amountCents).toBe(3000);
    await b.call('closeMonth', args(PAST));
    expect(await monthDoc(PAST)).toMatchObject({ status: 'closed', summary: { result: { fromUid: a.uid, amountCents: 13000 } } });
  });

  it('saldo diminuiu: quem recebeu devolve a diferença', async () => {
    await b.call('requestReopen', args(PAST, { reason: 'Gasto lançado em dobro' }));
    await a.call('answerReopen', args(PAST, { approve: true }));
    await expense(PAST, a, 8000); // A passa a dever R$ 60,00 (já pagou R$ 100,00)
    await expectError(a.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() })), 'permission-denied');
    const refund = await b.call<{ fromUid: string; toUid: string; amountCents: number }>(
      'registerPayment',
      args(PAST, { method: 'cash', paymentId: paymentId() }),
    );
    expect(refund).toMatchObject({ fromUid: b.uid, toUid: a.uid, amountCents: 4000 });
    await a.call('closeMonth', args(PAST));
    expect((await monthDoc(PAST))?.status).toBe('closed');
  });
});

describe('regras: mês fechado e reabertura só pelas Functions', () => {
  it('o app não reabre nem fecha mês gravando direto (reabrir sem aprovação)', async () => {
    await a.call('closeMonth', args(PAST));
    const fs = env.authenticatedContext(a.uid).firestore();
    await assertFails(fs.doc(`groups/${GROUP}/months/${PAST}`).update({ status: 'open' }));
    await assertFails(fs.doc(`groups/${GROUP}/months/${CURRENT}`).set({ status: 'closed' }));
  });

  it('gasto de mês fechado não é alterado nem excluído', async () => {
    const id = await expense(PAST, a, 10000);
    await expense(PAST, b, 10000);
    await a.call('closeMonth', args(PAST));
    const fs = env.authenticatedContext(a.uid).firestore();
    await assertFails(fs.doc(`groups/${GROUP}/expenses/${id}`).update({ description: 'Outro', status: 'pending_approval', updatedAt: new Date() }));
    await assertFails(fs.doc(`groups/${GROUP}/expenses/${id}`).delete());
  });
});
