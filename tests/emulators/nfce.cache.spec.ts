import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseError } from 'firebase/app';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEFAZ_SP_CANONICAL, checkDigit } from '../../functions/src/nfce';
import { clearAuth, closeApps, createTestEnv, signInAs, type TestUser } from './setup';

// Uma consulta por nota (v0.9.1): o resultado da consulta fica em nfceCache
// antes de a resolveNfce responder; leituras simultâneas da mesma nota esperam
// a primeira; a checkNfce espera a consulta do formulário em andamento (até o
// marcador ficar abandonado, 40 s); a retryNfce usa o resultado guardado. Sem
// rede: as páginas da SEFAZ são fictícias (emulatorFixtures/sefaz_{chave}) e
// cada consulta é contada em emulatorFixtures/sefazCalls_{chave}.

const GROUP = 'group-cache';
const keyFor = (serial: string) => {
  const base = `35261011222333000181650${serial.padStart(20, '0')}`;
  return base + checkDigit(base);
};
const url = (key: string) => `${SEFAZ_SP_CANONICAL}${key}|3|1`;

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);

const page = (issuer = 'LOJA TESTE LTDA', item = 'ARROZ 5KG') => `<html><body>
  <div id="u20" class="txtTopo">${issuer}</div>
  <div class="text">CNPJ: 11.222.333/0001-81</div>
  <table id="tabResult" class="filterable"><tr id="Item + 1"><td valign="top"><span class="txtTit">${item}</span>
    <span class="RCod"> (Código: 1 ) </span><br><span class="Rqtd"> <strong>Qtde.:</strong>1</span><span class="RUN"> <strong>UN: </strong>UN</span>
    <span class="RvlUnit"> <strong>Vl. Unit.:</strong> 55,48</span></td><td class="txtTit noWrap"> Vl. Total <br><span class="valor">55,48</span></td></tr></table>
  <div id="totalNota" class="txtRight"><div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">55,48</span></div></div>
  <li><strong>Emissão: </strong>05/10/2026 11:56:22 - Via Consumidor</li>
</body></html>`;
const blocked =
  "<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.</body></html>";

let env: RulesTestEnvironment;
let a: TestUser;

beforeAll(async () => {
  env = await createTestEnv();
  await clearAuth();
  a = await signInAs('ana-cache', 'Ana Teste');
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

/** Quantas consultas à SEFAZ (fictícia) a nota teve. */
async function consults(key: string): Promise<number> {
  return Number((await read(`emulatorFixtures/sefazCalls_${key}`))?.count ?? 0);
}

async function waitUntil<T>(get: () => Promise<T>, done: (v: T) => boolean, ms = 60_000): Promise<T> {
  const until = Date.now() + ms;
  let v = await get();
  while (Date.now() < until && !done(v)) {
    await new Promise((r) => setTimeout(r, 250));
    v = await get();
  }
  return v;
}

const status = (key: string, id: string) => async () =>
  ((await read(`groups/${GROUP}/expenses/${id}`))?.receipt as { nfceStatus?: string } | undefined)?.nfceStatus;

function expense(key: string, nfceStatus: string): Record<string, unknown> {
  return {
    description: 'Mercado',
    totalCents: 5548,
    personalCents: 0,
    payerUid: a.uid,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    competence: CURRENT,
    status: 'confirmed',
    createdBy: a.uid,
    createdAt: new Date(),
    updatedAt: new Date(),
    receipt: { type: 'nfce', nfceKey: key, entry: 'qr', nfceUrl: url(key), nfceStatus },
  };
}

const okResult = { issuerName: 'LOJA TESTE LTDA', totalCents: 5548, date: '2026-10-05' };
const cachedItems = (description: string) => ({
  items: [{ description, quantity: 1, unit: 'UN', unitPrice: '55,48', totalCents: 5548 }],
  discountCents: 0,
  totalCents: 5548,
  payments: [],
  itemsSumCents: 5548,
  consistent: true,
});

async function expectError(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, 'era esperado um erro').toBeInstanceOf(FirebaseError);
  expect((err as FirebaseError).code).toBe(`functions/${code}`);
}

beforeEach(async () => {
  await env.clearFirestore();
  await seed(`groups/${GROUP}`, { members: [a.uid], memberNames: { [a.uid]: 'Ana Teste' } });
});

describe('resolveNfce: o resultado fica guardado antes da resposta', () => {
  it('nota conferida: responde só depois de guardar o resultado e os itens; ler de novo não consulta', async () => {
    const key = keyFor('21');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    const first = await a.call<{ issuerName: string; totalCents: number }>('resolveNfce', { url: url(key) });
    expect(first).toMatchObject({ issuerName: 'LOJA TESTE LTDA', totalCents: 5548 });
    // Já está guardado quando a resposta chega.
    expect(await read(`nfceCache/${key}`)).toMatchObject({ state: 'ok', result: okResult, items: { totalCents: 5548 } });
    // O mesmo QR lido de novo (o caso de 08/11): o resultado guardado, sem nova consulta.
    expect(await a.call('resolveNfce', { url: url(key) })).toMatchObject({ issuerName: 'LOJA TESTE LTDA' });
    expect(await consults(key)).toBe(1);
  }, 60_000);

  it('o que o formulário mostra é o que é gravado: os itens da resposta são os guardados e os que o gatilho grava', async () => {
    const key = keyFor('25');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    const shown = await a.call<{ items: Record<string, unknown> | null }>('resolveNfce', { url: url(key) });
    expect(shown.items).toMatchObject({ totalCents: 5548, items: [{ description: 'ARROZ 5KG', totalCents: 5548 }] });
    expect((await read(`nfceCache/${key}`))?.items).toEqual(shown.items);
    // O gasto salvo com a nota (pending): o gatilho grava exatamente os itens mostrados, sem consultar de novo.
    await seed(`groups/${GROUP}/expenses/s1`, expense(key, 'pending'));
    const saved = await waitUntil(() => read(`groups/${GROUP}/nfceItems/${key}`), (d) => !!d);
    const { fetchedAt, source, ...savedItems } = saved as Record<string, unknown>;
    expect(fetchedAt).toBeDefined();
    expect(source).toBe('checkNfce');
    expect(savedItems).toEqual(shown.items);
    expect(await consults(key)).toBe(1);
  }, 60_000);

  it('falha ao guardar o resultado: responde falha (o app segue para o aparelho ou o plano B)', async () => {
    const key = keyFor('22');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page(), failCacheWrites: true });
    await expectError(a.call('resolveNfce', { url: url(key) }), 'unavailable');
    expect(await consults(key)).toBe(1);
  }, 60_000);

  it('leituras simultâneas da mesma nota: uma consulta só; a segunda espera o resultado da primeira', async () => {
    const key = keyFor('23');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page(), delayMs: 3000 });
    const [r1, r2] = await Promise.all([
      a.call<{ totalCents: number }>('resolveNfce', { url: url(key) }),
      a.call<{ totalCents: number }>('resolveNfce', { url: url(key) }),
    ]);
    expect([r1.totalCents, r2.totalCents]).toEqual([5548, 5548]);
    expect(await consults(key)).toBe(1);
  }, 60_000);

  it('leituras simultâneas e a SEFAZ barra: as duas falham com uma consulta só', async () => {
    const key = keyFor('24');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: blocked, delayMs: 3000 });
    const results = await Promise.allSettled([a.call('resolveNfce', { url: url(key) }), a.call('resolveNfce', { url: url(key) })]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(await consults(key)).toBe(1);
  }, 60_000);
});

describe('checkNfce e o resultado guardado', () => {
  it('consulta do formulário em andamento: o gatilho espera o resultado dela, sem consultar', async () => {
    const key = keyFor('31');
    // Se o gatilho consultasse, o emitente seria outro.
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page('NAO DEVIA CONSULTAR') });
    await seed(`nfceCache/${key}`, { state: 'running', startedAt: new Date(), expireAt: new Date(Date.now() + 86_400_000) });
    await seed(`groups/${GROUP}/expenses/w1`, expense(key, 'pending'));
    await new Promise((r) => setTimeout(r, 4000));
    expect(await status(key, 'w1')()).toBe('pending'); // ainda esperando
    await seed(`nfceCache/${key}`, { state: 'ok', result: okResult, items: cachedItems('DO FORMULARIO'), expireAt: new Date(Date.now() + 86_400_000) });
    expect(await waitUntil(status(key, 'w1'), (s) => s !== 'pending')).toBe('ok');
    const items = await waitUntil(() => read(`groups/${GROUP}/nfceItems/${key}`), (d) => !!d);
    expect((items?.items as Array<{ description: string }>).map((i) => i.description)).toEqual(['DO FORMULARIO']);
    expect(await consults(key)).toBe(0);
  }, 90_000);

  it('marcador abandonado (40 s ou mais): o gatilho não espera nele e faz a consulta prevista', async () => {
    const key = keyFor('32');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    await seed(`nfceCache/${key}`, { state: 'running', startedAt: new Date(Date.now() - 60_000), expireAt: new Date(Date.now() + 86_400_000) });
    const started = Date.now();
    await seed(`groups/${GROUP}/expenses/w2`, expense(key, 'pending'));
    expect(await waitUntil(status(key, 'w2'), (s) => s !== 'pending')).toBe('ok');
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await consults(key)).toBe(1);
  }, 90_000);

  it('lançado offline (sem registro da nota): uma consulta, e os itens oficiais substituem os lidos no aparelho', async () => {
    const key = keyFor('33');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    await seed(`groups/${GROUP}/nfceItems/${key}`, { ...cachedItems('LIDO NO APARELHO'), source: 'device', fetchedAt: new Date() });
    await seed(`groups/${GROUP}/expenses/w3`, expense(key, 'pending'));
    expect(await waitUntil(status(key, 'w3'), (s) => s !== 'pending')).toBe('ok');
    const items = await waitUntil(() => read(`groups/${GROUP}/nfceItems/${key}`), (d) => d?.source === 'checkNfce');
    expect(items).toMatchObject({ source: 'checkNfce' });
    expect((items?.items as Array<{ description: string }>).map((i) => i.description)).toEqual(['ARROZ 5KG']);
    expect(await consults(key)).toBe(1);
  }, 90_000);

  it('nota "unchecked" com resultado guardado não é consultada pelo gatilho (fica para a nova tentativa)', async () => {
    const key = keyFor('34');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    await seed(`groups/${GROUP}/expenses/w4`, expense(key, 'unchecked'));
    await new Promise((r) => setTimeout(r, 3000));
    expect(await status(key, 'w4')()).toBe('unchecked');
    expect(await consults(key)).toBe(0);
  }, 60_000);
});

describe('retryNfce e o resultado guardado', () => {
  it('nota lida pelo servidor no formulário e gravada como "unchecked" (o caso de 08/11): aplica o resultado guardado, sem consultar nem gastar a tentativa', async () => {
    const key = keyFor('41');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: blocked });
    await seed(`nfceCache/${key}`, { state: 'ok', result: okResult, items: cachedItems('DO CACHE'), expireAt: new Date(Date.now() + 86_400_000) });
    await seed(`groups/${GROUP}/expenses/r1`, expense(key, 'unchecked'));
    const r = await a.call<{ ok: boolean }>('retryNfce', { groupId: GROUP, expenseId: 'r1' });
    expect(r.ok).toBe(true);
    expect(await read(`groups/${GROUP}/expenses/r1`)).toMatchObject({ receipt: { nfceStatus: 'ok', nfceData: okResult } });
    expect(await read(`groups/${GROUP}/nfceItems/${key}`)).toMatchObject({ source: 'retryNfce', items: [{ description: 'DO CACHE' }] });
    expect(await consults(key)).toBe(0);
    expect(await read(`groups/${GROUP}/nfceRetry/${key}`)).toBeUndefined();
  }, 60_000);

  it('resultado guardado vencido (mais de 30 dias): consulta, com o limite de 1 minuto', async () => {
    const key = keyFor('42');
    await seed(`emulatorFixtures/sefaz_${key}`, { html: page() });
    await seed(`nfceCache/${key}`, { state: 'ok', result: okResult, items: null, expireAt: new Date(Date.now() - 1000) });
    await seed(`groups/${GROUP}/expenses/r2`, expense(key, 'unchecked'));
    expect((await a.call<{ ok: boolean }>('retryNfce', { groupId: GROUP, expenseId: 'r2' })).ok).toBe(true);
    expect(await consults(key)).toBe(1);
    expect(await read(`groups/${GROUP}/nfceRetry/${key}`)).toBeDefined();
  }, 60_000);
});
