import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_ID, createTestEnv } from './setup';

// Geração dos recorrentes (a mesma função da Function agendada), rodando com o
// Admin SDK contra o emulador do projeto de teste.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { generateRecurring } = await import('../../functions/src/recurring');

const A = 'uid-a';
const B = 'uid-b';
const GROUP = 'group-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B] });
  });
});

/** Cadastro semeado; campos `undefined` são omitidos (o Firestore não aceita undefined). */
function recurring(overrides: Record<string, unknown> = {}) {
  const data = {
    description: 'Internet',
    kind: 'fixed',
    amountCents: 12000,
    dayOfMonth: 10,
    payerUid: A,
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

async function seed(id: string, data: Record<string, unknown>, path = 'recurring'): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}/${path}/${id}`).set(data);
  });
}

async function expenses(): Promise<Array<Record<string, unknown> & { id: string }>> {
  let list: Array<Record<string, unknown> & { id: string }> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().collection(`groups/${GROUP}/expenses`).get();
    list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return list;
}

async function readRecurring(id: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(`groups/${GROUP}/recurring/${id}`).get()).data();
  });
  return data;
}

describe('generateRecurring', () => {
  it('fixo aprovado gera o gasto do mês confirmado, com quem paga como autor', async () => {
    await seed('r1', recurring());
    expect(await generateRecurring('2026-10-12')).toEqual({ created: 1, skipped: 0 });
    const [e] = await expenses();
    expect(e).toMatchObject({
      id: 'rec-r1-2026-10',
      status: 'confirmed',
      totalCents: 12000,
      date: '2026-10-10',
      competence: '2026-10',
      createdBy: A,
      recurringId: 'r1',
    });
    expect(e.approval).toBeUndefined();
    expect((await readRecurring('r1'))?.lastGeneratedMonth).toBe('2026-10');
  });

  it('é idempotente: rodar de novo (ou em paralelo) não duplica', async () => {
    await seed('r1', recurring());
    await Promise.all([generateRecurring('2026-10-12'), generateRecurring('2026-10-12')]);
    await generateRecurring('2026-10-13');
    expect(await expenses()).toHaveLength(1);
  });

  it('um gasto gerado e depois excluído não volta', async () => {
    await seed('r1', recurring());
    await generateRecurring('2026-10-12');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}/expenses/rec-r1-2026-10`).delete();
    });
    await generateRecurring('2026-10-13');
    expect(await expenses()).toHaveLength(0);
  });

  it('variável gera aguardando quem paga confirmar o valor', async () => {
    await seed('v1', recurring({ kind: 'variable', amountCents: undefined, payerUid: B, createdBy: A }));
    await generateRecurring('2026-10-12');
    const [e] = await expenses();
    expect(e).toMatchObject({ status: 'awaiting_confirmation', totalCents: 0, createdBy: B });
  });

  it('fixo sem aprovação (pendente ou recusado) não gera', async () => {
    await seed('p1', recurring({ status: 'pending_approval' }));
    await seed('p2', recurring({ status: 'returned' }));
    await generateRecurring('2026-10-12');
    expect(await expenses()).toHaveLength(0);
  });

  it('no dia 1 gera todos do mês, com a data do vencimento', async () => {
    await seed('cedo', recurring({ dayOfMonth: 20 }));
    await generateRecurring('2026-10-01');
    expect((await expenses())[0]).toMatchObject({ date: '2026-10-20', competence: '2026-10' });
  });

  it('desativado e fora do período não geram', async () => {
    await seed('off', recurring({ active: false }));
    await seed('fim', recurring({ endMonth: '2026-09' }));
    await seed('inicio', recurring({ startMonth: '2026-11' }));
    await generateRecurring('2026-10-12');
    expect(await expenses()).toHaveLength(0);
  });

  it('dia 31 em fevereiro: gerado no dia 1 com a data no último dia', async () => {
    await seed('r31', recurring({ dayOfMonth: 31 }));
    await generateRecurring('2026-02-01');
    expect((await expenses())[0]).toMatchObject({ date: '2026-02-28', competence: '2026-02' });
  });

  it('cadastrado ou aprovado no meio do mês é gerado na execução seguinte', async () => {
    await seed('novo', recurring({ status: 'pending_approval' }));
    await generateRecurring('2026-10-15');
    expect(await expenses()).toHaveLength(0);
    await seed('novo', recurring({ status: 'approved' }));
    await generateRecurring('2026-10-16');
    expect(await expenses()).toHaveLength(1);
  });

  it('mês fechado: entra no próximo mês aberto, mantendo a data', async () => {
    await seed('2026-10', { status: 'closed' }, 'months');
    await seed('r1', recurring());
    await generateRecurring('2026-10-12');
    expect((await expenses())[0]).toMatchObject({ date: '2026-10-10', competence: '2026-11' });
  });

  it('pagador que não é membro não gera', async () => {
    await seed('x', recurring({ payerUid: 'uid-c' }));
    await generateRecurring('2026-10-12');
    expect(await expenses()).toHaveLength(0);
  });
});
