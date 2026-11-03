import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { checkDigit, spConsultUrl } from '../../functions/src/nfce';
import { fiscalKeyData, newExpenseData, type ExpenseInput } from '../../src/services/expenseData';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// NFC-e de SP depois do filtro da SEFAZ (v0.8.5): nota sem conferência
// ('unchecked') com a URL, itens lidos no aparelho e o limite da nova tentativa.
// UIDs e chaves fictícios: A e B são o casal, C é um terceiro.
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';

function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);
const keyFor = (serial: string) => {
  const base = `35261011222333000181650${serial.padStart(20, '0')}`;
  return base + checkDigit(base);
};
const KEY = keyFor('7');

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});

afterAll(async () => {
  await env.cleanup();
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const itemsPath = `groups/${GROUP}/nfceItems/${KEY}`;

const input: ExpenseInput = {
  description: 'Mercado',
  totalCents: 5548,
  personalCents: 0,
  payerUid: A,
  payerSharePct: 50,
  date: `${CURRENT}-05`,
  receipt: { type: 'nfce', nfceKey: KEY, entry: 'qr' },
};

/** Gasto com a chave e o registro da nota, num lote (como o app grava). */
function createWithKey(id: string, receiptOverride: Record<string, unknown> = {}, uid = A, dropUrl = false) {
  const fs = db(uid);
  const data = newExpenseData({ ...input, payerUid: uid }, uid, CURRENT, { groupId: GROUP, expenseId: id }, serverTime());
  const receipt: Record<string, unknown> = { ...data.receipt, ...receiptOverride };
  if (dropUrl) delete receipt.nfceUrl;
  return fs
    .batch()
    .set(fs.doc(expPath(id)), { ...data, receipt })
    .set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData(id, uid, serverTime()))
    .commit();
}

const deviceItems = (over: Record<string, unknown> = {}) => ({
  items: [{ description: 'ARROZ 5KG', quantity: 1, unit: 'UN', unitPrice: '25,90', totalCents: 2590 }],
  discountCents: 0,
  totalCents: 2590,
  payments: [{ method: 'Pix', amountCents: 2590 }],
  itemsSumCents: 2590,
  consistent: true,
  issuerName: 'LOJA TESTE LTDA',
  date: `${CURRENT}-05`,
  fetchedAt: serverTime(),
  source: 'device',
  ...over,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  });
});

describe('NFC-e de SP sem conferência', () => {
  it("'pending' ou 'unchecked', sempre com a URL montada da chave", async () => {
    await assertSucceeds(createWithKey('p1'));
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
    });
    await assertSucceeds(createWithKey('u1', { nfceStatus: 'unchecked' }));
  });

  it("'unchecked' sem a URL, ou com outra URL, e 'ok' gravado pelo app são recusados", async () => {
    await assertFails(createWithKey('u2', { nfceStatus: 'unchecked' }, A, true));
    await assertFails(createWithKey('u3', { nfceStatus: 'unchecked', nfceUrl: `${spConsultUrl(KEY)}x` }));
    await assertFails(createWithKey('u4', { nfceStatus: 'ok', nfceData: { issuerName: 'X', totalCents: 1, date: `${CURRENT}-05` } }));
  });
});

describe('itens lidos no aparelho', () => {
  it('quem lançou o gasto com a chave cria uma vez; o outro membro e terceiros não', async () => {
    await assertSucceeds(createWithKey('e1', { nfceStatus: 'unchecked' }));
    await assertFails(db(B).doc(itemsPath).set(deviceItems()));
    await assertFails(db(C).doc(itemsPath).set(deviceItems()));
    await assertSucceeds(db(A).doc(itemsPath).set(deviceItems()));
    // Nunca alterados nem apagados pelo app (nem os oficiais).
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ totalCents: 1 })));
    await assertFails(db(A).doc(itemsPath).delete());
    await assertSucceeds(db(B).doc(itemsPath).get());
    await assertFails(db(C).doc(itemsPath).get());
  });

  it('sem gasto com a chave, não cria', async () => {
    await assertFails(db(A).doc(itemsPath).set(deviceItems()));
  });

  it('formato: só origem "device", lista até 200 itens, totais inteiros, horário do servidor, nada a mais', async () => {
    await assertSucceeds(createWithKey('e1', { nfceStatus: 'unchecked' }));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ source: 'checkNfce' })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ items: Array.from({ length: 201 }, () => ({})) })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ totalCents: 25.9 })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ fetchedAt: new Date() })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ conferida: true })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ date: '05/10/2026' })));
  });
});

describe('limite da nova tentativa (nfceRetry)', () => {
  it('membros leem; ninguém grava pelo app', async () => {
    const path = `groups/${GROUP}/nfceRetry/${KEY}`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path).set({ lastAt: new Date(), byUid: A });
    });
    await assertSucceeds(db(A).doc(path).get());
    await assertSucceeds(db(B).doc(path).get());
    await assertFails(db(C).doc(path).get());
    await assertFails(db(A).doc(path).set({ lastAt: new Date(0), byUid: A }));
    await assertFails(db(A).doc(path).delete());
  });

  it('o cache do servidor e a chave de configuração ficam fora do app', async () => {
    await assertFails(db(A).doc(`nfceCache/${KEY}`).get());
    await assertFails(db(A).doc('config/nfce').get());
    await assertFails(db(A).doc('config/nfce').set({ sefazEnabled: false }));
  });
});
