import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv } from './setup';

// Geração na hora (gatilho `generateRecurringOnWrite`, rodando no emulador de
// Functions): variável cadastrado, fixo aprovado ou cadastro reativado geram o
// gasto do mês atual. O "hoje" do gatilho vem de `emulatorFixtures/clock`.

const A = 'uid-a';
const B = 'uid-b';
const TODAY = '2026-10-12';
let GROUP = '';
let seq = 0;

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  // Sem o relógio, o gatilho volta a não gerar nos outros arquivos de teste.
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('emulatorFixtures/clock').delete());
  await env.cleanup();
});

beforeEach(async () => {
  GROUP = `grupo-gerar-${++seq}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('emulatorFixtures/clock').set({ today: TODAY });
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B] });
  });
});

function recurring(overrides: Record<string, unknown> = {}) {
  const data = {
    description: 'Luz',
    kind: 'variable',
    dayOfMonth: 15,
    payerUid: B,
    payerSharePct: 50,
    startMonth: '2026-01',
    active: true,
    status: 'approved',
    createdBy: A,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

async function write(path: string, data: Record<string, unknown>, merge = false): Promise<void> {
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(path).set(data, { merge }));
}

async function expense(id: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(`groups/${GROUP}/expenses/${id}`).get()).data();
  });
  return data;
}

async function lastGenerated(id: string): Promise<unknown> {
  let value: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    value = (await ctx.firestore().doc(`groups/${GROUP}/recurring/${id}`).get()).get('lastGeneratedMonth');
  });
  return value;
}

/** Espera o gatilho gravar o gasto (ou confirma que não gravou, depois de `ms`). */
async function waitExpense(id: string, ms = 20000): Promise<Record<string, unknown> | undefined> {
  const until = Date.now() + ms;
  let data = await expense(id);
  while (!data && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    data = await expense(id);
  }
  return data;
}

/** Dá tempo ao gatilho e confirma que nada foi gerado. */
async function expectNothing(id: string): Promise<void> {
  expect(await waitExpense(id, 5000)).toBeUndefined();
}

describe('geração na hora (gatilho do cadastro)', () => {
  it('variável cadastrado gera o mês atual na hora, aguardando quem paga', async () => {
    await write(`groups/${GROUP}/recurring/v1`, recurring());
    const e = await waitExpense('rec-v1-2026-10');
    expect(e).toMatchObject({ status: 'awaiting_confirmation', totalCents: 0, createdBy: B, date: '2026-10-15', recurringId: 'v1' });
    expect(await lastGenerated('v1')).toBe('2026-10');
  }, 40_000);

  it('fixo pendente não gera; ao ser aprovado, gera confirmado', async () => {
    await write(`groups/${GROUP}/recurring/f1`, recurring({ kind: 'fixed', amountCents: 12000, payerUid: A, status: 'pending_approval' }));
    await expectNothing('rec-f1-2026-10');
    await write(`groups/${GROUP}/recurring/f1`, { status: 'approved', approval: { byUid: B, at: new Date() } }, true);
    expect(await waitExpense('rec-f1-2026-10')).toMatchObject({ status: 'confirmed', totalCents: 12000, createdBy: A });
  }, 40_000);

  it('fora do período, desativado ou com pagador de fora do grupo não gera', async () => {
    await write(`groups/${GROUP}/recurring/n1`, recurring({ startMonth: '2026-11' }));
    await write(`groups/${GROUP}/recurring/n2`, recurring({ endMonth: '2026-09' }));
    await write(`groups/${GROUP}/recurring/n3`, recurring({ active: false }));
    await write(`groups/${GROUP}/recurring/n4`, recurring({ payerUid: 'uid-c' }));
    for (const id of ['n1', 'n2', 'n3', 'n4']) await expectNothing(`rec-${id}-2026-10`);
  }, 40_000);

  it('idempotente: nova gravação não duplica, e o gasto excluído não volta', async () => {
    await write(`groups/${GROUP}/recurring/v2`, recurring());
    expect(await waitExpense('rec-v2-2026-10')).toBeDefined();
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`groups/${GROUP}/expenses/rec-v2-2026-10`).delete());
    // Editar e reativar o cadastro no mesmo mês não recria o gasto.
    await write(`groups/${GROUP}/recurring/v2`, { description: 'Luz de casa', active: false }, true);
    await write(`groups/${GROUP}/recurring/v2`, { active: true }, true);
    await expectNothing('rec-v2-2026-10');
  }, 40_000);
});
