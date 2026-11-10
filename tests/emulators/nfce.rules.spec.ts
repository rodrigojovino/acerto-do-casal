import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkDigit, spConsultUrl } from '../../functions/src/nfce';
import { expenseUpdateData, fiscalKeyData, newExpenseData, newInstallmentSeriesData, type ExpenseInput } from '../../src/services/expenseData';
import { deviceItemsData } from '../../src/services/nfceItemsData';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// NFC-e de SP depois do filtro da SEFAZ (v0.9.0): nota sem conferência
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
  it('quem lançou o gasto com a chave cria; o outro membro e terceiros não', async () => {
    await assertSucceeds(createWithKey('e1', { nfceStatus: 'unchecked' }));
    await assertFails(db(B).doc(itemsPath).set(deviceItems()));
    await assertFails(db(C).doc(itemsPath).set(deviceItems()));
    await assertSucceeds(db(A).doc(itemsPath).set(deviceItems()));
    // Lido no aparelho pode ser trocado por outro lido no aparelho (nova leitura), só por quem lançou; nunca apagado.
    await assertSucceeds(db(A).doc(itemsPath).set(deviceItems({ totalCents: 1 })));
    await assertFails(db(B).doc(itemsPath).set(deviceItems({ totalCents: 2 })));
    await assertFails(db(A).doc(itemsPath).delete());
    await assertSucceeds(db(B).doc(itemsPath).get());
    await assertFails(db(C).doc(itemsPath).get());
  });

  it('itens oficiais (do servidor) nunca são trocados nem apagados pelo app', async () => {
    await assertSucceeds(createWithKey('e1', { nfceStatus: 'unchecked' }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(itemsPath).set({ ...deviceItems(), fetchedAt: new Date(), source: 'checkNfce' });
    });
    await assertFails(db(A).doc(itemsPath).set(deviceItems()));
    await assertFails(db(A).doc(itemsPath).delete());
  });

  it('sem gasto com a chave, não cria', async () => {
    await assertFails(db(A).doc(itemsPath).set(deviceItems()));
  });

  it('formato: só origem "device", lista até 990 itens (o máximo da NFC-e), totais inteiros, horário do servidor, nada a mais', async () => {
    await assertSucceeds(createWithKey('e1', { nfceStatus: 'unchecked' }));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ source: 'checkNfce' })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ items: Array.from({ length: 991 }, () => ({})) })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ totalCents: 25.9 })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ fetchedAt: new Date() })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ conferida: true })));
    await assertFails(db(A).doc(itemsPath).set(deviceItems({ date: '05/10/2026' })));
  });
});

describe('itens lidos no aparelho no mesmo lote do gasto (v0.9.1)', () => {
  const read = { items: deviceItems().items as never, page: { issuerName: 'LOJA TESTE LTDA', date: `${CURRENT}-05` } };
  const itemsDoc = (over: Record<string, unknown> = {}) => ({
    ...deviceItemsData({ ...read, items: { items: read.items, discountCents: 0, totalCents: 2590, payments: [], itemsSumCents: 2590, consistent: true } }, serverTime()),
    ...over,
  });
  const exists = async (path: string) => {
    let found = false;
    await env.withSecurityRulesDisabled(async (ctx) => {
      found = (await ctx.firestore().doc(path).get()).exists;
    });
    return found;
  };

  /** Lançamento como o app grava: gasto, registro da nota e itens, num lote. */
  function launch(id: string, items: Record<string, unknown> | null, uid = A) {
    const fs = db(uid);
    const data = newExpenseData({ ...input, payerUid: uid }, uid, CURRENT, { groupId: GROUP, expenseId: id }, serverTime());
    const batch = fs
      .batch()
      .set(fs.doc(expPath(id)), { ...data, receipt: { ...data.receipt, nfceStatus: 'unchecked' } })
      .set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData(id, uid, serverTime()));
    if (items) batch.set(fs.doc(itemsPath), items);
    return batch.commit();
  }

  it('gasto, registro da nota e itens num lote: aceito', async () => {
    await assertSucceeds(launch('l1', itemsDoc()));
    expect(await exists(itemsPath)).toBe(true);
  });

  it('itens recusados derrubam o lote inteiro: nem o gasto nem o registro ficam (nada pela metade)', async () => {
    await assertFails(launch('l2', itemsDoc({ items: Array.from({ length: 991 }, () => ({})) })));
    expect(await exists(expPath('l2'))).toBe(false);
    expect(await exists(`groups/${GROUP}/fiscalKeys/${KEY}`)).toBe(false);
    expect(await exists(itemsPath)).toBe(false);
  });

  it('com itens oficiais já gravados, o lote com itens é recusado; sem os itens, o gasto entra (o app não os manda)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(itemsPath).set({ ...deviceItems(), fetchedAt: new Date(), source: 'checkNfce' });
    });
    await assertFails(launch('l3', itemsDoc()));
    await assertSucceeds(launch('l3', null));
  });

  it('itens de outro membro no lote dele (registro da nota de quem lançou): recusado', async () => {
    await assertSucceeds(launch('l4', null));
    const fs = db(B);
    await assertFails(fs.batch().set(fs.doc(itemsPath), itemsDoc()).commit());
  });

  it('offline: o lote com gasto, registro e itens fica pendente e sobe inteiro quando a conexão volta', async () => {
    const fs = db(A);
    await fs.disableNetwork();
    const data = newExpenseData(input, A, CURRENT, { groupId: GROUP, expenseId: 'off1' }, serverTime());
    const commit = fs
      .batch()
      .set(fs.doc(expPath('off1')), { ...data, receipt: { ...data.receipt, nfceStatus: 'unchecked' } })
      .set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData('off1', A, serverTime()))
      .set(fs.doc(itemsPath), itemsDoc())
      .commit();
    // Sem conexão: o gasto e os itens estão no cache local, juntos, ainda sem servidor.
    expect((await fs.doc(expPath('off1')).get({ source: 'cache' })).exists).toBe(true);
    expect((await fs.doc(itemsPath).get({ source: 'cache' })).exists).toBe(true);
    expect(await exists(expPath('off1'))).toBe(false);
    expect(await exists(itemsPath)).toBe(false);
    await fs.enableNetwork();
    await assertSucceeds(commit);
    expect(await exists(expPath('off1'))).toBe(true);
    expect(await exists(itemsPath)).toBe(true);
  });

  it('offline com itens recusados: ao voltar a conexão, nada fica (nem o gasto sem os itens)', async () => {
    const fs = db(A);
    await fs.disableNetwork();
    const data = newExpenseData(input, A, CURRENT, { groupId: GROUP, expenseId: 'off2' }, serverTime());
    const commit = fs
      .batch()
      .set(fs.doc(expPath('off2')), { ...data, receipt: { ...data.receipt, nfceStatus: 'unchecked' } })
      .set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData('off2', A, serverTime()))
      .set(fs.doc(itemsPath), itemsDoc({ items: Array.from({ length: 991 }, () => ({})) }))
      .commit();
    await fs.enableNetwork();
    await assertFails(commit);
    expect(await exists(expPath('off2'))).toBe(false);
    expect(await exists(itemsPath)).toBe(false);
    // O cache local também descarta o lote inteiro (o app detecta e avisa: launchGuard e itemsGuard).
    expect((await fs.doc(expPath('off2')).get({ source: 'cache' }).catch(() => null))?.exists ?? false).toBe(false);
  });

  it('caminho da v0.9.0 contra as regras novas: gasto num lote, itens gravados depois, sozinhos', async () => {
    await assertSucceeds(createWithKey('v090', { nfceStatus: 'unchecked' }));
    await assertSucceeds(db(A).doc(itemsPath).set(deviceItems()));
    expect(await exists(itemsPath)).toBe(true);
  });

  it('caminho da v0.9.0 com o gasto recusado: os itens, gravados depois, também são recusados', async () => {
    await assertFails(db(A).doc(itemsPath).set(deviceItems()));
  });

  it('edição que inclui a chave: gasto, registro e itens num lote', async () => {
    const fs = db(A);
    const none = newExpenseData({ ...input, receipt: { type: 'none' } }, A, CURRENT, { groupId: GROUP, expenseId: 'ed1' }, serverTime());
    await assertSucceeds(fs.doc(expPath('ed1')).set(none));
    const edit = expenseUpdateData(
      input,
      CURRENT,
      { groupId: GROUP, expenseId: 'ed1' },
      { receipt: { type: 'none' }, status: 'pending_approval' },
      serverTime(),
      firebase.firestore.FieldValue.delete(),
    );
    await assertSucceeds(
      fs
        .batch()
        .update(fs.doc(expPath('ed1')), { ...edit, receipt: { ...edit.receipt, nfceStatus: 'unchecked' } })
        .set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData('ed1', A, serverTime()))
        .set(fs.doc(itemsPath), itemsDoc())
        .commit(),
    );
  });

  // Medição do ajuste 3: o caso que mais gasta leituras das regras (48 parcelas
  // começando 6 meses atrás, cada mês passado conferido como aberto) com o
  // registro da nota e os itens no mesmo lote.
  it('48 parcelas começando 6 meses atrás, com o registro da nota e os itens, num lote', async () => {
    const first = month(-6);
    const parcels = newInstallmentSeriesData(
      { ...input, date: `${first}-20`, totalCents: 480000 },
      { count: 48, firstMonth: first },
      A,
      { groupId: GROUP, seriesId: 's48' },
      serverTime(),
    );
    const fs = db(A);
    const batch = fs.batch();
    for (const p of parcels) batch.set(fs.doc(expPath(p.id)), { ...p.data, receipt: { ...p.data.receipt, nfceStatus: 'unchecked' } });
    batch.set(fs.doc(`groups/${GROUP}/fiscalKeys/${KEY}`), fiscalKeyData('s48', A, serverTime()));
    batch.set(fs.doc(itemsPath), itemsDoc());
    await assertSucceeds(batch.commit());
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
