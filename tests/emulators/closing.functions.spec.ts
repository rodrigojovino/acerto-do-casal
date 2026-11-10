import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseError } from 'firebase/app';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monthOf, todayInSaoPaulo } from '../../src/domain/calendar';
import { monthBreakdown } from '../../src/domain/closing';
import { addMonths, monthBalance } from '../../src/domain/settlement';
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

describe('parte só do parceiro (v0.9.2): a mesma conta do app no fechamento', () => {
  it('o pagamento e a memória de cálculo da Function batem com monthBalance e monthBreakdown do app', async () => {
    // A paga R$ 200,00 (R$ 50,00 só de A, R$ 30,00 só de B); B paga R$ 100,00 (R$ 40,00 só de A), divisão 70/30.
    const rows = [
      { payer: a, total: 20000, personalCents: 5000, partnerOnlyCents: 3000, payerSharePct: 50 },
      { payer: b, total: 10000, personalCents: 0, partnerOnlyCents: 4000, payerSharePct: 70 },
      { payer: b, total: 12345, personalCents: 0, partnerOnlyCents: 0, payerSharePct: 50 },
    ];
    for (const r of rows) await expense(PAST, r.payer, r.total, { personalCents: r.personalCents, partnerOnlyCents: r.partnerOnlyCents, payerSharePct: r.payerSharePct });
    const members = [a.uid, b.uid] as const;
    const appView = rows.map((r) => ({
      totalCents: r.total,
      personalCents: r.personalCents,
      partnerOnlyCents: r.partnerOnlyCents,
      payerUid: r.payer.uid,
      payerSharePct: r.payerSharePct,
      status: 'confirmed' as const,
    }));
    const expected = monthBalance(appView, members)!;
    // B deve 3000 + 6000 = 9000; A deve 4000 + round(6000 × 30%) = 5800 e 6173 (12345/2 arredondado): A deve 2973 a B.
    expect(expected).toEqual({ fromUid: a.uid, toUid: b.uid, amountCents: 5800 + 6173 - 9000 });
    const payer = expected.fromUid === a.uid ? a : b;
    const payment = await payer.call<{ fromUid: string; amountCents: number }>('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() }));
    expect(payment).toMatchObject({ fromUid: expected.fromUid, amountCents: expected.amountCents });
    await a.call('closeMonth', args(PAST));
    const summary = (await monthDoc(PAST))?.summary as Record<string, unknown>;
    expect(summary).toEqual(JSON.parse(JSON.stringify(monthBreakdown(appView, members))));
    expect(summary).toMatchObject({ partnerOnlyCents: 7000, personalCents: 5000 });
  });
});

describe('cancelar pagamento (v0.9.3)', () => {
  const pixPhoto = async (month: string, id: string) =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .storage(`gs://${PROJECT_ID}.appspot.com`)
        .ref(`groups/${GROUP}/settlements/${month}/${id}.jpg`)
        .put(new Uint8Array(512), { contentType: 'image/jpeg' });
    });
  const outbox = async () => {
    let docs: Array<Record<string, unknown>> = [];
    await env.withSecurityRulesDisabled(async (ctx) => {
      docs = (await ctx.firestore().collection('notificationOutbox').get()).docs.map((d) => d.data());
    });
    return docs;
  };
  type CallError = FirebaseError & { details?: { reason?: string; remaining?: { amountCents: number; fromUid: string } } };
  const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as CallError);

  it('quem recebe não cancela; terceiro não cancela; quem registrou cancela, com log sem a foto e aviso para o outro', async () => {
    await expense(PAST, b, 20000); // A deve R$ 100,00 a B
    const id = paymentId();
    await pixPhoto(PAST, id);
    await a.call('registerPayment', args(PAST, { method: 'pix', paymentId: id, expectedCents: 10000 }));
    await expectError(b.call('cancelPayment', args(PAST, { paymentId: id })), 'permission-denied', /Só quem registrou/);
    const c = await signInAs('cris', 'Pessoa C');
    await expectError(c.call('cancelPayment', args(PAST, { paymentId: id })), 'permission-denied');

    await a.call('cancelPayment', args(PAST, { paymentId: id, reason: 'comprovante errado' }));
    expect((await monthDoc(PAST))?.payments).toEqual([]);
    const log = await read(`groups/${GROUP}/months/${PAST}/log/cancel-${id}`);
    expect(log).toMatchObject({ type: 'payment_cancelled', by: 'member', byUid: a.uid, paymentId: id, amountCents: 10000, method: 'pix', reason: 'comprovante errado' });
    expect(JSON.stringify(log)).not.toContain('settlements/');

    // Aviso para B (quem recebe), na categoria do acerto.
    const until = Date.now() + 15_000;
    let notices: Array<Record<string, unknown>> = [];
    while (Date.now() < until && !notices.some((n) => n.title === 'Pagamento cancelado')) {
      await new Promise((r) => setTimeout(r, 300));
      notices = await outbox();
    }
    const notice = notices.find((n) => n.title === 'Pagamento cancelado');
    expect(notice).toMatchObject({ toUid: b.uid, category: 'settlement' });
    expect(String(notice?.body)).toMatch(/^Pessoa cancelou o pagamento de R\$\s?100,00 registrado em \d\d\/\d\d$/);
  }, 60_000);

  it('cancelar e registrar de novo com outra foto: o valor exato que falta é recalculado', async () => {
    await expense(PAST, b, 20000);
    const first = paymentId();
    await pixPhoto(PAST, first);
    await a.call('registerPayment', args(PAST, { method: 'pix', paymentId: first }));
    await expectError(a.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId() })), 'failed-precondition', /nada a pagar/);
    await a.call('cancelPayment', args(PAST, { paymentId: first }));
    const second = paymentId();
    await pixPhoto(PAST, second);
    const again = await a.call<{ amountCents: number; receiptPath: string }>(
      'registerPayment',
      args(PAST, { method: 'pix', paymentId: second, expectedCents: 10000 }),
    );
    expect(again).toMatchObject({ amountCents: 10000, receiptPath: `groups/${GROUP}/settlements/${PAST}/${second}.jpg` });
    await b.call('closeMonth', args(PAST));
    expect((await monthDoc(PAST))?.status).toBe('closed');
  }, 60_000);

  it('valor que mudou desde a confirmação: registerPayment recusa e devolve o novo valor', async () => {
    await expense(PAST, b, 20000);
    const err = await failure(a.call('registerPayment', args(PAST, { method: 'cash', paymentId: paymentId(), expectedCents: 9000 })));
    expect(err?.code).toBe('functions/failed-precondition');
    expect(err?.details).toMatchObject({ reason: 'amount_changed', remaining: { amountCents: 10000, fromUid: a.uid } });
    expect((await monthDoc(PAST))?.payments ?? []).toEqual([]);
  }, 60_000);

  it('mês fechado recusa, com o motivo claro', async () => {
    await expense(PAST, b, 20000);
    const id = paymentId();
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: id }));
    await a.call('closeMonth', args(PAST));
    const err = await failure(a.call('cancelPayment', args(PAST, { paymentId: id })));
    expect(err?.code).toBe('functions/failed-precondition');
    expect(err?.details?.reason).toBe('closed');
    expect(err?.message).toMatch(/fechado/);
  }, 60_000);

  it('mês reaberto: pagamento do fechamento anterior recusa; o registrado depois da reabertura pode', async () => {
    await expense(PAST, b, 20000);
    const old = paymentId();
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: old }));
    await a.call('closeMonth', args(PAST));
    await a.call('requestReopen', args(PAST, { reason: 'Faltou um gasto' }));
    await b.call('answerReopen', args(PAST, { approve: true }));
    const err = await failure(a.call('cancelPayment', args(PAST, { paymentId: old })));
    expect(err?.details?.reason).toBe('previous_closing');
    await expense(PAST, b, 4000); // A deve mais R$ 20,00
    const after = paymentId();
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: after, expectedCents: 2000 }));
    await a.call('cancelPayment', args(PAST, { paymentId: after }));
    expect(((await monthDoc(PAST))?.payments as Array<{ id: string }>).map((p) => p.id)).toEqual([old]);
  }, 60_000);

  it('cancelPayment e closeMonth ao mesmo tempo: só um vence e o mês fica consistente', async () => {
    await expense(PAST, b, 20000);
    const id = paymentId();
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: id }));
    const [cancel, close] = await Promise.allSettled([a.call('cancelPayment', args(PAST, { paymentId: id })), b.call('closeMonth', args(PAST))]);
    const m = await monthDoc(PAST);
    expect([cancel.status, close.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    if (close.status === 'fulfilled') expect(m).toMatchObject({ status: 'closed', payments: [{ id }] });
    else expect(m).toMatchObject({ status: 'open', payments: [] });
  }, 60_000);

  it('cancelPayment e registerPayment ao mesmo tempo: nunca dois pagamentos, e o que falta fecha com a lista', async () => {
    await expense(PAST, b, 20000);
    const first = paymentId();
    await a.call('registerPayment', args(PAST, { method: 'cash', paymentId: first }));
    const second = paymentId();
    const [cancel, register] = await Promise.allSettled([
      a.call('cancelPayment', args(PAST, { paymentId: first })),
      a.call('registerPayment', args(PAST, { method: 'cash', paymentId: second, expectedCents: 10000 })),
    ]);
    expect(cancel.status).toBe('fulfilled');
    const list = ((await monthDoc(PAST))?.payments as Array<{ id: string; amountCents: number }>) ?? [];
    // Registrado antes do cancelamento: recusado (nada a pagar) e a lista fica vazia;
    // depois: entra no lugar do cancelado. Nunca os dois.
    if (register.status === 'fulfilled') expect(list).toMatchObject([{ id: second, amountCents: 10000 }]);
    else expect(list).toEqual([]);
  }, 60_000);

  it('o log do mês é fechado para o app: nenhum membro lê nem grava', async () => {
    const path = `groups/${GROUP}/months/${PAST}/log/x`;
    await write(path, { type: 'payment_cancelled' });
    for (const uid of [a.uid, b.uid]) {
      const fs = env.authenticatedContext(uid).firestore();
      await assertFails(fs.doc(path).get());
      await assertFails(fs.collection(`groups/${GROUP}/months/${PAST}/log`).get());
      await assertFails(fs.doc(`groups/${GROUP}/months/${PAST}/log/y`).set({ type: 'payment_cancelled' }));
    }
  });
});
