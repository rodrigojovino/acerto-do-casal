import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEFAZ_SP_CANONICAL, checkDigit } from '../../functions/src/nfce';
import { createTestEnv } from './setup';

// Gatilho checkNfce (Functions emulator). Nenhum teste acessa a SEFAZ:
// as notas "conferidas" são montadas à mão, e a URL pendente é de fora de SP,
// recusada pelo parser antes de qualquer rede.

const A = 'uid-a';
const B = 'uid-b';
const GROUP = 'group-1';
// Chaves fictícias de NFC-e (SP e MG) com dígito verificador válido.
const keyFor = (ufCode: string) => {
  const base = `${ufCode}26101122233300018165001000000123112345678`;
  return base + checkDigit(base);
};
const KEY = keyFor('35');
const KEY_MG = keyFor('31');
// URL canônica fictícia da SEFAZ-SP (as regras exigem esse formato na edição pelo app).
const SP_URL = `${SEFAZ_SP_CANONICAL}${KEY}|2|1|1|${'A'.repeat(40)}`;
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
// 20 s: a primeira execução do gatilho no emulador pode demorar (partida da Function).
async function waitFor(id: string, done: (d: Record<string, unknown>) => boolean, ms = 20000) {
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
    // URL sem chave: recusada pelo parser antes de qualquer rede.
    await write('falha', nfceExpense({ nfceStatus: 'pending' }));
    const d = await waitFor('falha', (x) => (x.receipt as { nfceStatus: string }).nfceStatus !== 'pending');
    const receipt = d?.receipt as { nfceStatus: string; nfceError: string };
    expect(receipt.nfceStatus).toBe('failed');
    expect(receipt.nfceError).toBe('invalid_url');
    expect(d?.status).toBe('pending_approval');
  });

  it('nota de outro estado ("unchecked") não é consultada nem confirmada', async () => {
    const data = nfceExpense({ nfceKey: KEY_MG, nfceStatus: 'unchecked' });
    delete (data.receipt as Record<string, unknown>).nfceUrl;
    await write('mg', data);
    await new Promise((r) => setTimeout(r, 3000));
    const d = await read('mg');
    expect(d?.status).toBe('pending_approval');
    expect((d?.receipt as { nfceStatus: string }).nfceStatus).toBe('unchecked');
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

  it('editar um gasto confirmado pelo QR volta a pendente e o gatilho confere de novo', async () => {
    await write('editado', nfceExpense({ nfceUrl: SP_URL, nfceStatus: 'ok', nfceData: okData(5548) }));
    await waitFor('editado', (x) => x.status === 'confirmed');

    // Edição de quem lançou, pelas regras (como o app): só a descrição muda.
    const db = env.authenticatedContext(A).firestore();
    await db.doc(path('editado')).update({
      description: 'Mercado do mês',
      status: 'pending_approval',
      approval: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const d = await waitFor('editado', (x) => x.status === 'confirmed' && x.description === 'Mercado do mês');
    expect(d?.status).toBe('confirmed');
    expect((d?.approval as { byUid: string }).byUid).toBe('nfce');
  });

  it('editar o valor de um gasto confirmado pelo QR deixa pendente (diverge da nota)', async () => {
    await write('valor', nfceExpense({ nfceUrl: SP_URL, nfceStatus: 'ok', nfceData: okData(5548) }));
    await waitFor('valor', (x) => x.status === 'confirmed');
    const db = env.authenticatedContext(A).firestore();
    await db.doc(path('valor')).update({
      totalCents: 6000,
      status: 'pending_approval',
      approval: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await new Promise((r) => setTimeout(r, 3000));
    const d = await read('valor');
    expect(d?.status).toBe('pending_approval');
    expect(d?.approval).toBeUndefined();
  });
});
