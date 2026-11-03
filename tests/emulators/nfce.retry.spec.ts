import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseError } from 'firebase/app';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEFAZ_SP_CANONICAL, checkDigit } from '../../functions/src/nfce';
import { clearAuth, closeApps, createTestEnv, signInAs, type TestUser } from './setup';

// "Tentar conferir de novo" (Function retryNfce): uma consulta pelo servidor,
// no máximo uma a cada 15 minutos por nota, contada no servidor. Sem rede: as
// páginas da SEFAZ são fictícias (emulatorFixtures/sefaz_{chave}).

const GROUP = 'group-retry';
const keyFor = (serial: string) => {
  const base = `35261011222333000181650${serial.padStart(20, '0')}`;
  return base + checkDigit(base);
};
const KEY = keyFor('11');
const KEY_BLOCKED = keyFor('12');
const url = (key: string) => `${SEFAZ_SP_CANONICAL}${key}|3|1`;

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);

const page = `<html><body>
  <div id="u20" class="txtTopo">LOJA TESTE LTDA</div>
  <div class="text">CNPJ: 11.222.333/0001-81</div>
  <table id="tabResult" class="filterable"><tr id="Item + 1"><td valign="top"><span class="txtTit">ARROZ 5KG</span>
    <span class="RCod"> (Código: 1 ) </span><br><span class="Rqtd"> <strong>Qtde.:</strong>1</span><span class="RUN"> <strong>UN: </strong>UN</span>
    <span class="RvlUnit"> <strong>Vl. Unit.:</strong> 55,48</span></td><td class="txtTit noWrap"> Vl. Total <br><span class="valor">55,48</span></td></tr></table>
  <div id="totalNota" class="txtRight"><div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">55,48</span></div></div>
  <li><strong>Emissão: </strong>05/10/2026 11:56:22 - Via Consumidor</li>
</body></html>`;
const blocked =
  "<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.</body></html>";

let env: RulesTestEnvironment;
let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  env = await createTestEnv();
  await clearAuth();
  a = await signInAs('ana-retry', 'Ana Teste');
  b = await signInAs('bia-retry', 'Bia Teste');
}, 60_000);

afterAll(async () => {
  await closeApps();
  await env.cleanup();
});

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
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

function expense(key: string, status: string, createdBy = a.uid): Record<string, unknown> {
  return {
    description: 'Mercado',
    totalCents: 5548,
    personalCents: 0,
    payerUid: createdBy,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    competence: CURRENT,
    status: 'confirmed',
    createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
    // 'unchecked': sem o gatilho de conferência (o teste é só da nova tentativa).
    receipt: { type: 'nfce', nfceKey: key, entry: 'qr', nfceUrl: url(key), nfceStatus: status },
  };
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

beforeEach(async () => {
  await env.clearFirestore();
  await seed(`groups/${GROUP}`, { members: [a.uid, b.uid], memberNames: { [a.uid]: 'Ana Teste', [b.uid]: 'Bia Teste' } });
  await seed(`emulatorFixtures/sefaz_${KEY}`, { html: page });
  await seed(`emulatorFixtures/sefaz_${KEY_BLOCKED}`, { html: blocked });
});

describe('retryNfce', () => {
  it('quem lançou confere de novo: grava "ok", os dados e os itens oficiais', async () => {
    await seed(`groups/${GROUP}/expenses/e1`, expense(KEY, 'unchecked'));
    const r = await a.call<{ ok: boolean; retryAt: number }>('retryNfce', { groupId: GROUP, expenseId: 'e1' });
    expect(r.ok).toBe(true);
    expect(r.retryAt).toBeGreaterThan(Date.now() + 14 * 60_000);
    const d = await read(`groups/${GROUP}/expenses/e1`);
    expect(d?.receipt).toMatchObject({ nfceStatus: 'ok', nfceData: { issuerName: 'LOJA TESTE LTDA', totalCents: 5548, date: '2026-10-05' } });
    expect(await read(`groups/${GROUP}/nfceItems/${KEY}`)).toMatchObject({ source: 'retryNfce', totalCents: 5548 });
  }, 60_000);

  it('uma tentativa a cada 15 minutos por nota: a segunda, logo depois, é recusada', async () => {
    await seed(`groups/${GROUP}/expenses/e2`, expense(KEY_BLOCKED, 'failed'));
    const first = await a.call<{ ok: boolean; reason?: string }>('retryNfce', { groupId: GROUP, expenseId: 'e2' });
    expect(first).toMatchObject({ ok: false, reason: 'blocked' });
    await expectError(a.call('retryNfce', { groupId: GROUP, expenseId: 'e2' }), 'resource-exhausted', /Tente de novo mais tarde/);
    // Falha não muda a nota (continua sem conferência).
    expect(((await read(`groups/${GROUP}/expenses/e2`))?.receipt as { nfceStatus: string }).nfceStatus).toBe('failed');
  }, 60_000);

  it('toques rápidos ao mesmo tempo: só um passa', async () => {
    await seed(`groups/${GROUP}/expenses/e3`, expense(KEY_BLOCKED, 'failed'));
    const results = await Promise.allSettled([
      a.call('retryNfce', { groupId: GROUP, expenseId: 'e3' }),
      a.call('retryNfce', { groupId: GROUP, expenseId: 'e3' }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  }, 60_000);

  it('passados os 15 minutos, libera de novo', async () => {
    await seed(`groups/${GROUP}/expenses/e4`, expense(KEY, 'failed'));
    await seed(`groups/${GROUP}/nfceRetry/${KEY}`, { lastAt: new Date(Date.now() - 16 * 60_000), byUid: a.uid });
    expect((await a.call<{ ok: boolean }>('retryNfce', { groupId: GROUP, expenseId: 'e4' })).ok).toBe(true);
  }, 60_000);

  it('o outro membro não pede; nota já conferida e mês fechado também não', async () => {
    await seed(`groups/${GROUP}/expenses/e5`, expense(KEY, 'failed'));
    await expectError(b.call('retryNfce', { groupId: GROUP, expenseId: 'e5' }), 'permission-denied');
    await seed(`groups/${GROUP}/expenses/e6`, { ...expense(KEY, 'ok') });
    await expectError(a.call('retryNfce', { groupId: GROUP, expenseId: 'e6' }), 'failed-precondition', /já foi conferida/);
    await seed(`groups/${GROUP}/months/${CURRENT}`, { status: 'closed' });
    await expectError(a.call('retryNfce', { groupId: GROUP, expenseId: 'e5' }), 'failed-precondition', /mês fechado/);
  }, 60_000);
});
