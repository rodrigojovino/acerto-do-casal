import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
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
  // Aquecimento: a primeira execução do gatilho no emulador pode passar de 20 s
  // (partida da Function). Dispara uma vez e espera, fora dos testes.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc('groups/aquecimento/expenses/e').set({
      receipt: { type: 'nfce', nfceKey: KEY, nfceUrl: 'https://exemplo.invalid/qr', nfceStatus: 'pending' },
    });
  });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    let status: string | undefined;
    await env.withSecurityRulesDisabled(async (ctx) => {
      status = (await ctx.firestore().doc('groups/aquecimento/expenses/e').get()).get('receipt.nfceStatus');
    });
    if (status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 90_000);

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

describe('checkNfce: só registra, nunca muda o status', () => {
  it('QR que não pode ser conferido vira failed e o gasto continua confirmado', async () => {
    // URL sem chave: recusada pelo parser antes de qualquer rede.
    await write('falha', nfceExpense({ nfceStatus: 'pending' }, { status: 'confirmed' }));
    const d = await waitFor('falha', (x) => (x.receipt as { nfceStatus: string }).nfceStatus !== 'pending');
    const receipt = d?.receipt as { nfceStatus: string; nfceError: string };
    expect(receipt.nfceStatus).toBe('failed');
    expect(receipt.nfceError).toBe('invalid_url');
    expect(d?.status).toBe('confirmed');
    expect(d?.approval).toBeUndefined();
  });

  it('nota conferida com valor igual não mexe num pendente antigo', async () => {
    await write('igual', nfceExpense({ nfceUrl: SP_URL, nfceStatus: 'ok', nfceData: okData(5548) }));
    await new Promise((r) => setTimeout(r, 3000));
    const d = await read('igual');
    expect(d?.status).toBe('pending_approval');
    expect(d?.approval).toBeUndefined();
  });

  it('valor divergente fica só como aviso: o gasto continua confirmado', async () => {
    await write('diferente', nfceExpense({ nfceUrl: SP_URL, nfceStatus: 'ok', nfceData: okData(9999) }, { status: 'confirmed' }));
    await new Promise((r) => setTimeout(r, 3000));
    const d = await read('diferente');
    expect(d?.status).toBe('confirmed');
    expect((d?.receipt as { nfceData: { totalCents: number } }).nfceData.totalCents).toBe(9999);
  });

  it('nota de outro estado ("unchecked") não é consultada', async () => {
    const data = nfceExpense({ nfceKey: KEY_MG, nfceStatus: 'unchecked' }, { status: 'confirmed' });
    delete (data.receipt as Record<string, unknown>).nfceUrl;
    await write('mg', data);
    await new Promise((r) => setTimeout(r, 3000));
    const d = await read('mg');
    expect(d?.status).toBe('confirmed');
    expect((d?.receipt as { nfceStatus: string }).nfceStatus).toBe('unchecked');
  });

  it('gasto contestado não é alterado pela nota', async () => {
    const rejection = { byUid: B, at: new Date(), kind: 'contest', reason: 'Valor errado' };
    await write('contestado', nfceExpense({ nfceUrl: SP_URL, nfceStatus: 'ok', nfceData: okData(5548) }, { status: 'returned', rejection }));
    await new Promise((r) => setTimeout(r, 3000));
    expect((await read('contestado'))?.status).toBe('returned');
  });
});

describe('checkNfce: NF-e', () => {
  it('chave de NF-e (modelo 55) não dispara consulta: fica "unchecked"', async () => {
    const nfe = KEY.slice(0, 20) + '55' + KEY.slice(22);
    const data = nfceExpense({ nfceKey: nfe, entry: 'typed', nfceStatus: 'unchecked' }, { status: 'confirmed' });
    delete (data.receipt as Record<string, unknown>).nfceUrl;
    await write('nfe', data);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await read('nfe'))?.receipt).toEqual({ type: 'nfce', nfceKey: nfe, entry: 'typed', nfceStatus: 'unchecked' });
  });
});

describe('checkNfce: compra parcelada', () => {
  it('só a parcela 1 consulta; o resultado vale para todas as parcelas da série', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const batch = ctx.firestore().batch();
      for (const index of [1, 2, 3]) {
        const id = index === 1 ? 'serie' : `serie-${index}`;
        batch.set(
          ctx.firestore().doc(path(id)),
          nfceExpense(
            { nfceStatus: 'pending' },
            { status: 'confirmed', installment: { seriesId: 'serie', index, count: 3, firstMonth: '2026-10', purchaseCents: 16644 } },
          ),
        );
      }
      await batch.commit();
    });
    for (const id of ['serie', 'serie-2', 'serie-3']) {
      const d = await waitFor(id, (x) => (x.receipt as { nfceStatus: string }).nfceStatus !== 'pending');
      const receipt = d?.receipt as { nfceStatus: string; nfceError: string };
      expect(receipt.nfceStatus).toBe('failed');
      expect(receipt.nfceError).toBe('invalid_url');
      expect(d?.status).toBe('confirmed');
    }
  });

  it('parcela que não é a 1 não consulta sozinha', async () => {
    await write(
      'avulsa-2',
      nfceExpense(
        { nfceStatus: 'pending' },
        { installment: { seriesId: 'avulsa', index: 2, count: 3, firstMonth: '2026-10', purchaseCents: 16644 } },
      ),
    );
    await new Promise((r) => setTimeout(r, 3000));
    expect(((await read('avulsa-2'))?.receipt as { nfceStatus: string }).nfceStatus).toBe('pending');
  });
});
