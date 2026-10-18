import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv } from './setup';

// Gatilho checkNfce (Functions emulator). Nenhum teste acessa a SEFAZ:
// as notas "conferidas" são montadas à mão, e a URL pendente é de fora de SP,
// recusada pelo parser antes de qualquer rede.

const A = 'uid-a';
const B = 'uid-b';
const GROUP = 'group-1';
const KEY = '3'.repeat(44);
const path = (id: string) => `groups/${GROUP}/expenses/${id}`;

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

function nfceExpense(receipt: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    description: 'Mercado',
    totalCents: 5548,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: '2026-10-05',
    competence: '2026-10',
    status: 'pending_approval',
    createdBy: A,
    createdAt: new Date(),
    updatedAt: new Date(),
    receipt: { type: 'nfce', nfceKey: KEY, nfceUrl: 'https://exemplo.invalid/qr', ...receipt },
    ...overrides,
  };
}

async function write(id: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path(id)).set(data);
  });
}

async function read(id: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(path(id)).get()).data();
  });
  return data;
}

/** Espera o gatilho agir (ou o tempo acabar) e devolve o documento. */
async function waitFor(id: string, done: (d: Record<string, unknown>) => boolean, ms = 8000) {
  const until = Date.now() + ms;
  let data = await read(id);
  while (Date.now() < until && !(data && done(data))) {
    await new Promise((r) => setTimeout(r, 250));
    data = await read(id);
  }
  return data;
}

const okData = (totalCents: number) => ({ issuerName: 'LOJA TESTE LTDA', totalCents, date: '2026-10-05' });

describe('checkNfce', () => {
  it('nota conferida com valor igual confirma o gasto, marcando a conferência como aprovadora', async () => {
    await write('igual', nfceExpense({ nfceStatus: 'ok', nfceData: okData(5548) }));
    const d = await waitFor('igual', (x) => x.status === 'confirmed');
    expect(d?.status).toBe('confirmed');
    expect((d?.approval as { byUid: string }).byUid).toBe('nfce');
  });

  it('valor diferente da nota continua pendente', async () => {
    await write('diferente', nfceExpense({ nfceStatus: 'ok', nfceData: okData(9999) }));
    await new Promise((r) => setTimeout(r, 3000));
    expect((await read('diferente'))?.status).toBe('pending_approval');
  });

  it('QR pendente que não pode ser conferido vira failed e segue pendente', async () => {
    await write('falha', nfceExpense({ nfceStatus: 'pending' }));
    const d = await waitFor('falha', (x) => (x.receipt as { nfceStatus: string }).nfceStatus !== 'pending');
    const receipt = d?.receipt as { nfceStatus: string; nfceError: string };
    expect(receipt.nfceStatus).toBe('failed');
    expect(receipt.nfceError).toBe('not_sp');
    expect(d?.status).toBe('pending_approval');
  });

  it('gasto devolvido não é confirmado pela nota', async () => {
    await write('devolvido', nfceExpense({ nfceStatus: 'ok', nfceData: okData(5548) }, { status: 'returned' }));
    await new Promise((r) => setTimeout(r, 3000));
    expect((await read('devolvido'))?.status).toBe('returned');
  });

  it('não confirma em mês fechado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}/months/2026-10`).set({ status: 'closed' });
    });
    await write('fechado', nfceExpense({ nfceStatus: 'ok', nfceData: okData(5548) }));
    await new Promise((r) => setTimeout(r, 3000));
    expect((await read('fechado'))?.status).toBe('pending_approval');
  });
});
