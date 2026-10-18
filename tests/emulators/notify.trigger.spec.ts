import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_ID, createTestEnv } from './setup';

// Avisos (gatilhos no emulador de Functions). Sem FCM no emulador: cada aviso
// que seria enviado vai para `notificationOutbox`; tokens "invalid-…" simulam
// a recusa do FCM. UIDs, nomes e tokens fictícios.

const A = 'uid-a';
const B = 'uid-b';
let GROUP = 'grupo';
let seq = 0;

let env: RulesTestEnvironment;

async function write(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

async function exists(path: string): Promise<boolean> {
  let found = false;
  await env.withSecurityRulesDisabled(async (ctx) => {
    found = (await ctx.firestore().doc(path).get()).exists;
  });
  return found;
}

interface OutboxItem {
  toUid: string;
  category: string;
  title: string;
  body: string;
  route: string;
  tokens: string[];
  badge: number;
}

async function outbox(): Promise<OutboxItem[]> {
  let items: OutboxItem[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().collection('notificationOutbox').where('groupId', '==', GROUP).get();
    items = snap.docs.map((d) => d.data() as OutboxItem);
  });
  return items;
}

/** Espera os gatilhos (até `count` avisos ou o tempo acabar) e um pouco mais, para pegar duplicados. */
async function waitOutbox(count: number, ms = 20000, settle = 2500): Promise<OutboxItem[]> {
  const until = Date.now() + ms;
  let items = await outbox();
  while (Date.now() < until && items.length < count) {
    await new Promise((r) => setTimeout(r, 250));
    items = await outbox();
  }
  await new Promise((r) => setTimeout(r, settle));
  return outbox();
}

function expense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Mercado',
    totalCents: 21400,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: '2026-10-10',
    competence: '2026-10',
    receipt: { type: 'none' },
    status: 'pending_approval',
    createdBy: A,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  env = await createTestEnv();
  // Aquecimento: a primeira execução dos gatilhos no emulador pode demorar.
  GROUP = 'aquecimento';
  await write(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Ana Teste', [B]: 'Bia Teste' } });
  await write(`groups/${GROUP}/expenses/e`, expense());
  await waitOutbox(1, 60000, 0);
}, 90_000);

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  GROUP = `grupo${++seq}`;
  await write(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Ana Teste', [B]: 'Bia Teste' } });
  await write(`users/${A}/devices/aparelhoA1`, { token: `token-a-${seq}`, platform: 'android', appVersion: '0.7.0', updatedAt: new Date() });
  await write(`users/${B}/devices/aparelhoB1`, { token: `token-b-${seq}`, platform: 'android', appVersion: '0.7.0', updatedAt: new Date() });
  await write(`users/${A}`, { notificationPrefs: {} });
  await write(`users/${B}`, { notificationPrefs: {} });
});

describe('quem recebe', () => {
  it('gasto lançado: só o outro membro, em todos os aparelhos dele, com o contador', async () => {
    await write(`users/${B}/devices/aparelhoB2`, { token: `token-b2-${seq}`, platform: 'android', appVersion: '0.7.0', updatedAt: new Date() });
    await write(`groups/${GROUP}/expenses/g1`, expense());
    const [n, ...rest] = await waitOutbox(1);
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({ toUid: B, category: 'expenses', route: '/gasto/g1', badge: 1 });
    expect(n.body.replace(/\s/g, ' ')).toBe('Ana lançou Mercado · R$ 214,00 · toque para aprovar');
    expect(n.tokens.sort()).toEqual([`token-b-${seq}`, `token-b2-${seq}`]);
  });

  it('devolução avisa quem lançou; aprovar não avisa ninguém', async () => {
    await write(`groups/${GROUP}/expenses/g1`, expense());
    await waitOutbox(1);
    await write(
      `groups/${GROUP}/expenses/g1`,
      expense({ status: 'returned', rejection: { byUid: B, kind: 'reject', reason: 'anexe a nota', at: new Date() } }),
    );
    const items = await waitOutbox(2);
    expect(items.filter((i) => i.toUid === A)).toEqual([
      expect.objectContaining({ category: 'returns', body: 'Bia recusou Mercado: “anexe a nota”' }),
    ]);
    await write(`groups/${GROUP}/expenses/g2`, expense({ status: 'confirmed', approval: { byUid: B, at: new Date() } }));
    expect((await waitOutbox(3, 4000)).length).toBe(3); // só o lançamento de g2, nenhum de aprovação
  });

  it('categoria desligada por quem recebe: não envia', async () => {
    await write(`users/${B}`, { notificationPrefs: { expenses: false } });
    await write(`groups/${GROUP}/expenses/g1`, expense());
    expect(await waitOutbox(1, 5000)).toEqual([]);
  });

  it('aparelho sem token não quebra; token recusado pelo FCM é apagado', async () => {
    await write(`users/${B}/devices/aparelhoB1`, { token: 'invalid-velho', platform: 'android', appVersion: '0.6.0', updatedAt: new Date() });
    await write(`groups/${GROUP}/expenses/g1`, expense());
    await waitOutbox(1);
    expect(await exists(`users/${B}/devices/aparelhoB1`)).toBe(false);
    await write(`users/${A}/devices/aparelhoA1`, { platform: 'android' });
    await write(`groups/${GROUP}/expenses/g2`, expense({ createdBy: B, payerUid: B }));
    const toA = (await waitOutbox(2)).filter((i) => i.toUid === A);
    expect(toA).toHaveLength(1);
    expect(toA[0].tokens).toEqual([]);
  });
});

describe('série de parcelas: um aviso só', () => {
  const parcels = (count: number, overrides: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, i) => ({
      id: i === 0 ? 'serie' : `serie-${i + 1}`,
      data: expense({
        description: 'Geladeira',
        installment: { seriesId: 'serie', index: i + 1, count, firstMonth: '2026-10', purchaseCents: 21400 * count },
        ...overrides,
      }),
    }));

  async function batchWrite(items: Array<{ id: string; data: Record<string, unknown> }>): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const batch = ctx.firestore().batch();
      for (const p of items) batch.set(ctx.firestore().doc(`groups/${GROUP}/expenses/${p.id}`), p.data);
      await batch.commit();
    });
  }

  it('lançada num lote: um aviso, com o valor da série', async () => {
    await batchWrite(parcels(6));
    const items = await waitOutbox(1);
    expect(items).toHaveLength(1);
    expect(items[0].body.replace(/\s/g, ' ')).toBe('Ana lançou Geladeira · 6x de R$ 214,00 · toque para aprovar');
  });

  it('contestada num lote: um aviso só para a série inteira', async () => {
    await batchWrite(parcels(6, { status: 'confirmed', receipt: { type: 'photo', photoPath: 'x', photoUploaded: true } }));
    await waitOutbox(1);
    await batchWrite(
      parcels(6, {
        status: 'returned',
        receipt: { type: 'photo', photoPath: 'x', photoUploaded: true },
        rejection: { byUid: B, kind: 'contest', reason: 'não combinamos', at: new Date() },
      }),
    );
    const returns = (await waitOutbox(2)).filter((i) => i.category === 'returns');
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ toUid: A, body: 'Bia contestou a compra Geladeira: “não combinamos”' });
  });
});

describe('meses e recorrentes', () => {
  it('pagamento registrado avisa quem recebe; fechar avisa o outro', async () => {
    const payment = { id: 'p1', fromUid: A, toUid: B, amountCents: 41025, method: 'pix', byUid: A, at: new Date() };
    await write(`groups/${GROUP}/months/2026-10`, { status: 'open', payments: [payment] });
    await waitOutbox(1);
    await write(`groups/${GROUP}/months/2026-10`, { status: 'closed', payments: [payment], closedBy: B });
    const items = await waitOutbox(2);
    expect(items.find((i) => i.toUid === B)?.body.replace(/\s/g, ' ')).toBe(
      'Ana registrou o pagamento de R$ 410,25 (PIX) · confira o comprovante',
    );
    expect(items.find((i) => i.toUid === A)).toMatchObject({ body: 'Bia fechou outubro', route: '/historico/2026-10' });
  });

  it('recorrente fixo novo avisa o outro para aprovar', async () => {
    await write(`groups/${GROUP}/recurring/r1`, {
      description: 'Internet',
      kind: 'fixed',
      amountCents: 9900,
      dayOfMonth: 10,
      payerUid: A,
      payerSharePct: 50,
      startMonth: '2026-10',
      active: true,
      status: 'pending_approval',
      createdBy: A,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [n] = await waitOutbox(1);
    expect(n).toMatchObject({ toUid: B, category: 'recurring', route: '/ajustes/recorrentes/r1' });
  });

  it('dia 1: um único resumo dos variáveis para quem paga; os gerados não avisam um por um', async () => {
    process.env.GCLOUD_PROJECT = PROJECT_ID;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const { generateRecurring } = await import('../../functions/src/recurring');
    const variable = (description: string) => ({
      description,
      kind: 'variable',
      dayOfMonth: 10,
      payerUid: B,
      payerSharePct: 50,
      startMonth: '2026-01',
      active: true,
      status: 'approved',
      createdBy: B,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Só este grupo tem recorrentes: os outros grupos dos testes não geram nada.
    await write(`groups/${GROUP}/recurring/luz`, variable('Luz'));
    await write(`groups/${GROUP}/recurring/agua`, variable('Água'));
    await generateRecurring('2026-11-01');
    const items = await waitOutbox(1);
    expect(items).toEqual([
      expect.objectContaining({ toUid: B, category: 'recurring', route: '/pendencias', body: expect.stringMatching(/^2 recorrentes para confirmar o valor: (Luz, Água|Água, Luz)$/) }),
    ]);
  });
});

describe('regras: preferências e aparelhos', () => {
  const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

  it('cada um grava só as próprias preferências, com as quatro categorias', async () => {
    const fs = env.authenticatedContext(A).firestore();
    await assertSucceeds(fs.doc(`users/${A}`).set({ notificationPrefs: { expenses: false, returns: true, settlement: true, recurring: true } }));
    await assertFails(fs.doc(`users/${B}`).set({ notificationPrefs: { expenses: false } }));
    await assertFails(fs.doc(`users/${A}`).set({ notificationPrefs: { outra: true } }));
    await assertFails(fs.doc(`users/${A}`).set({ notificationPrefs: { expenses: 'sim' } }));
    await assertFails(env.authenticatedContext(B).firestore().doc(`users/${A}`).get());
  });

  it('cada um registra e apaga só os próprios aparelhos; ninguém lê o token do outro', async () => {
    const fs = env.authenticatedContext(A).firestore();
    const device = { token: 'token-novo', platform: 'android', appVersion: '0.7.0', updatedAt: serverTime() };
    await assertSucceeds(fs.doc(`users/${A}/devices/aparelhoA2`).set(device));
    await assertSucceeds(fs.doc(`users/${A}/devices/aparelhoA2`).delete());
    await assertFails(fs.doc(`users/${B}/devices/aparelhoA2`).set(device));
    await assertFails(fs.doc(`users/${A}/devices/x`).set(device));
    await assertFails(fs.doc(`users/${A}/devices/aparelhoA3`).set({ ...device, platform: 'ios' }));
    await assertFails(env.authenticatedContext(B).firestore().doc(`users/${A}/devices/aparelhoA1`).get());
  });

  it('o app não lê nem grava o registro de duplicidade nem a caixa de saída', async () => {
    const fs = env.authenticatedContext(A).firestore();
    await assertFails(fs.doc(`groups/${GROUP}/notificationLog/x`).get());
    await assertFails(fs.collection('notificationOutbox').get());
  });
});
