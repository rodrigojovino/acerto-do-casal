import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deletionRequestData,
  fiscalKeyData,
  installmentUpdateData,
  newExpenseData,
  newInstallmentSeriesData,
  receiptData,
  type ExpenseInput,
  type KeyEntry,
  type ReceiptChoice,
} from '../../src/services/expenseData';
import { checkDigit } from '../../functions/src/nfce';
import { createTestEnv } from './setup';

// UIDs fictícios: A e B são o casal, C é um terceiro.
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';

// Meses relativos a hoje (UTC, como as regras), para os testes não envelhecerem.
function month(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const CURRENT = month(0);
const CLOSED = month(-2);

// Chaves fictícias (nenhuma nota real), com dígito verificador válido.
function keyFor(uf: string, model: '55' | '65', serial: string): string {
  // UF (2) + AAMM (4) + CNPJ (14) + modelo (2) + série, número e código (21) + DV.
  const base = `${uf}261011222333000181${model}001${serial.padStart(18, '0')}`;
  return base + checkDigit(base);
}
const K1 = keyFor('35', '65', '1'); // NFC-e de SP
const K2 = keyFor('31', '65', '2'); // NFC-e de MG
const K3 = keyFor('35', '55', '3'); // NF-e

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const keyPath = (key: string) => `groups/${GROUP}/fiscalKeys/${key}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();
const ids = (expenseId: string) => ({ groupId: GROUP, expenseId });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
    await ctx.firestore().doc(`groups/${GROUP}/months/${CLOSED}`).set({ status: 'closed' });
  });
});

function input(uid: string, receipt: ReceiptChoice, date = `${CURRENT}-05`): ExpenseInput {
  return { description: 'Mercado', totalCents: 20000, personalCents: 0, payerUid: uid, payerSharePct: 50, date, receipt };
}

const nfce = (nfceKey: string, entry: KeyEntry = 'read'): ReceiptChoice => ({ type: 'nfce', nfceKey, entry });

/** Gasto novo como o app monta, com ou sem o registro da chave no mesmo lote. */
function create(
  uid: string,
  id: string,
  receipt: ReceiptChoice,
  opts: { register?: string | null; registerFor?: string; date?: string; competence?: string } = {},
) {
  const fs = db(uid);
  const data = newExpenseData(input(uid, receipt, opts.date), uid, opts.competence ?? CURRENT, ids(id), serverTime());
  const batch = fs.batch().set(fs.doc(expPath(id)), data);
  const register = opts.register === undefined ? (receipt.type === 'nfce' ? receipt.nfceKey : null) : opts.register;
  if (register) batch.set(fs.doc(keyPath(register)), fiscalKeyData(opts.registerFor ?? id, uid, serverTime()));
  return batch.commit();
}

/** Grava sem regras: gasto já lançado (e, se pedido, o registro dele). */
async function seed(id: string, data: Record<string, unknown>, registerAs?: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.doc(expPath(id)).set({ ...data, createdAt: new Date(), updatedAt: new Date() });
    const key = (data.receipt as { nfceKey?: string }).nfceKey;
    if (registerAs && key) await fs.doc(keyPath(key)).set({ expenseId: registerAs, createdBy: data.createdBy, createdAt: new Date() });
  });
}

/** Gasto com chave já lançado por `uid`, com o registro (ou sem, se anterior ao registro). */
function seedWithKey(id: string, key: string, opts: { uid?: string; competence?: string; registered?: boolean } = {}) {
  const uid = opts.uid ?? A;
  const competence = opts.competence ?? CURRENT;
  const data = newExpenseData(input(uid, nfce(key), `${competence}-05`), uid, competence, ids(id), null);
  return seed(id, data, opts.registered === false ? undefined : id);
}

/** Edição do comprovante como o app faz (vai para aprovação), com as mudanças do registro no mesmo lote. */
function editReceipt(
  uid: string,
  id: string,
  receipt: ReceiptChoice,
  registry: { register?: string; release?: string } = {},
) {
  const fs = db(uid);
  const batch = fs.batch().update(fs.doc(expPath(id)), {
    receipt: receiptData(receipt, ids(id)),
    status: 'pending_approval',
    updatedAt: serverTime(),
  });
  if (registry.register) batch.set(fs.doc(keyPath(registry.register)), fiscalKeyData(id, uid, serverTime()));
  if (registry.release) batch.delete(fs.doc(keyPath(registry.release)));
  return batch.commit();
}

/** Exclusão como o app faz: com chave, o registro sai no mesmo lote. */
/** Pedido de exclusão de quem lançou (gasto já confirmado só sai assim), num lote. */
function requestDeletion(uid: string, expenseIds: string[]) {
  const fs = db(uid);
  const batch = fs.batch();
  for (const id of expenseIds) batch.update(fs.doc(expPath(id)), deletionRequestData(uid, undefined, serverTime()));
  return batch.commit();
}

/** Exclusão: quem lançou (o que pode sair direto) ou o outro membro (aprovando o pedido). */
function remove(uid: string, id: string, release?: string) {
  const fs = db(uid);
  const batch = fs.batch().delete(fs.doc(expPath(id)));
  if (release) batch.delete(fs.doc(keyPath(release)));
  return batch.commit();
}

async function registryOf(key: string): Promise<string | null> {
  let owner: string | null = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().doc(keyPath(key)).get();
    owner = snap.exists ? (snap.data()!.expenseId as string) : null;
  });
  return owner;
}

describe('a mesma nota não entra duas vezes', () => {
  it('lançar com chave grava o registro no mesmo lote; sem ele, é recusado', async () => {
    await assertFails(create(A, 'e0', nfce(K1), { register: null }));
    await assertSucceeds(create(A, 'e1', nfce(K1)));
    expect(await registryOf(K1)).toBe('e1');
  });

  it('a mesma chave lida pelo QR e depois digitada é recusada (e o contrário)', async () => {
    await assertSucceeds(create(A, 'e1', nfce(K1, 'read')));
    await assertFails(create(A, 'e2', nfce(K1, 'typed')));
    await assertFails(create(B, 'e3', nfce(K1, 'typed')));
    await assertSucceeds(create(B, 'e4', nfce(K3, 'typed')));
    await assertFails(create(A, 'e5', nfce(K3, 'read')));
  });

  it('NF-e e NFC-e de outro estado também ficam presas', async () => {
    await assertSucceeds(create(A, 'e1', nfce(K2)));
    await assertSucceeds(create(A, 'e2', nfce(K3)));
    await assertFails(create(B, 'e3', nfce(K2)));
    await assertFails(create(B, 'e4', nfce(K3)));
  });

  it('os dois lançam a mesma nota ao mesmo tempo: só um lote passa', async () => {
    const results = await Promise.allSettled([create(A, 'da-a', nfce(K1)), create(B, 'da-b', nfce(K1, 'typed'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? 'da-a' : 'da-b';
    const loser = winner === 'da-a' ? 'da-b' : 'da-a';
    expect(await registryOf(K1)).toBe(winner);
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await ctx.firestore().doc(expPath(loser)).get()).exists).toBe(false);
    });
  });

  it('nota já lançada não entra pela data de um mês fechado (competência no mês aberto)', async () => {
    await seedWithKey('e1', K1);
    await assertFails(create(B, 'e2', nfce(K1), { date: `${CLOSED}-10`, competence: CURRENT }));
    // Sem o registro (só o gasto) também não.
    await assertFails(create(B, 'e3', nfce(K1), { date: `${CLOSED}-10`, competence: CURRENT, register: null }));
    // Outra nota, com a data do mês fechado, entra normalmente.
    await assertSucceeds(create(B, 'e4', nfce(K2), { date: `${CLOSED}-10`, competence: CURRENT }));
  });

  it('nota de um gasto em mês fechado continua presa', async () => {
    await seedWithKey('fechado', K1, { competence: CLOSED });
    await assertFails(create(A, 'e1', nfce(K1)));
    await assertFails(create(B, 'e2', nfce(K1)));
  });

  it('registro apontando para outro gasto não serve', async () => {
    await assertFails(create(A, 'e1', nfce(K1), { registerFor: 'outro' }));
  });
});

describe('edição', () => {
  it('editar para uma chave já usada é recusado', async () => {
    await seedWithKey('e1', K1);
    await seedWithKey('e2', K2, { uid: B });
    await assertFails(editReceipt(B, 'e2', nfce(K1), { register: K1, release: K2 }));
    await assertFails(editReceipt(B, 'e2', nfce(K1), { release: K2 }));
    // Sem comprovante, antes, e anexando a chave usada: também recusado.
    await seed('e3', newExpenseData(input(B, { type: 'none' }), B, CURRENT, ids('e3'), null));
    await assertFails(editReceipt(B, 'e3', nfce(K1, 'typed'), { register: K1 }));
    await assertFails(editReceipt(B, 'e3', nfce(K1, 'typed')));
  });

  it('trocar a chave registra a nova e solta a antiga no mesmo lote', async () => {
    await seedWithKey('e1', K1);
    await assertFails(editReceipt(A, 'e1', nfce(K3), { register: K3 })); // a antiga ficaria presa
    await assertFails(editReceipt(A, 'e1', nfce(K3), { release: K1 })); // a nova sem registro
    await assertSucceeds(editReceipt(A, 'e1', nfce(K3), { register: K3, release: K1 }));
    expect(await registryOf(K1)).toBeNull();
    expect(await registryOf(K3)).toBe('e1');
    // A antiga ficou livre.
    await assertSucceeds(create(B, 'e2', nfce(K1)));
  });

  it('tirar a chave (foto ou sem comprovante) solta o registro no mesmo lote', async () => {
    await seedWithKey('e1', K1);
    await seedWithKey('e2', K2);
    await assertFails(editReceipt(A, 'e1', { type: 'none' }));
    await assertSucceeds(editReceipt(A, 'e1', { type: 'none' }, { release: K1 }));
    await assertSucceeds(editReceipt(A, 'e2', { type: 'photo', replaced: true }, { release: K2 }));
    expect(await registryOf(K1)).toBeNull();
    expect(await registryOf(K2)).toBeNull();
  });

  it('editar mantendo a chave não mexe no registro, inclusive em gasto anterior ao registro', async () => {
    await seedWithKey('e1', K1);
    await seedWithKey('antigo', K2, { registered: false });
    for (const id of ['e1', 'antigo']) {
      await assertSucceeds(
        db(A).doc(expPath(id)).update({ description: 'Mercado do mês', status: 'pending_approval', updatedAt: serverTime() }),
      );
    }
  });
});

describe('o registro em si', () => {
  it('membros leem; terceiro não', async () => {
    await seedWithKey('e1', K1);
    await assertSucceeds(db(A).doc(keyPath(K1)).get());
    await assertSucceeds(db(B).collection(`groups/${GROUP}/fiscalKeys`).get());
    await assertFails(db(C).doc(keyPath(K1)).get());
  });

  it('apagar o registro pelo app é recusado enquanto o gasto usa a chave', async () => {
    await seedWithKey('e1', K1);
    await assertFails(db(A).doc(keyPath(K1)).delete());
    await assertFails(db(B).doc(keyPath(K1)).delete());
    await assertFails(db(C).doc(keyPath(K1)).delete());
  });

  it('o registro nunca é alterado (nem para apontar para outro gasto)', async () => {
    await seedWithKey('e1', K1);
    await seed('e2', newExpenseData(input(A, nfce(K1)), A, CURRENT, ids('e2'), null));
    await assertFails(db(A).doc(keyPath(K1)).set(fiscalKeyData('e2', A, serverTime())));
    await assertFails(db(A).doc(keyPath(K1)).update({ expenseId: 'e2' }));
  });

  it('não se cria registro para gasto de outra pessoa, sem a chave, ou fora do formato', async () => {
    // Gastos anteriores ao registro, sem ele.
    await seedWithKey('de-a', K1, { registered: false });
    await seed('sem-chave', newExpenseData(input(B, { type: 'none' }), B, CURRENT, ids('sem-chave'), null));
    // B bloqueando a nota de A.
    await assertFails(db(B).doc(keyPath(K1)).set(fiscalKeyData('de-a', B, serverTime())));
    // Chave que o gasto não usa (reserva de nota).
    await assertFails(db(B).doc(keyPath(K2)).set(fiscalKeyData('sem-chave', B, serverTime())));
    await assertFails(db(B).doc(keyPath(K2)).set(fiscalKeyData('nao-existe', B, serverTime())));
    // Formato: autor, horário do servidor e campos.
    await assertFails(db(A).doc(keyPath(K1)).set(fiscalKeyData('de-a', B, serverTime())));
    await assertFails(db(A).doc(keyPath(K1)).set(fiscalKeyData('de-a', A, new Date())));
    await assertFails(db(A).doc(keyPath(K1)).set({ ...fiscalKeyData('de-a', A, serverTime()), extra: 1 }));
    await assertFails(db(C).doc(keyPath(K1)).set(fiscalKeyData('de-a', C, serverTime())));
    // O próprio dono registra a nota anterior ao registro (é o que o script faz pelo servidor).
    await assertSucceeds(db(A).doc(keyPath(K1)).set(fiscalKeyData('de-a', A, serverTime())));
  });
});

describe('exclusão', () => {
  it('excluir o gasto solta a chave no mesmo lote; relançar a mesma nota funciona', async () => {
    await seedWithKey('e1', K1);
    // Confirmado: só sai pelo pedido, aprovado pelo outro membro.
    await assertSucceeds(requestDeletion(A, ['e1']));
    await assertFails(remove(B, 'e1')); // o registro ficaria preso
    await assertSucceeds(remove(B, 'e1', K1));
    expect(await registryOf(K1)).toBeNull();
    await assertSucceeds(create(B, 'e2', nfce(K1, 'typed')));
  });

  it('em mês fechado nem o gasto nem o registro saem', async () => {
    await seedWithKey('fechado', K1, { competence: CLOSED });
    await assertFails(remove(A, 'fechado', K1));
    await assertFails(remove(A, 'fechado'));
    await assertFails(db(A).doc(keyPath(K1)).delete());
  });

  it('gasto anterior ao registro sai sem registro; duplicata antiga não leva o registro da outra', async () => {
    await seedWithKey('antigo', K2, { registered: false });
    await assertSucceeds(requestDeletion(A, ['antigo']));
    await assertSucceeds(remove(B, 'antigo'));
    // Duas notas iguais de antes do registro: o registro aponta para a primeira.
    await seedWithKey('dup1', K1);
    await seed('dup2', newExpenseData(input(A, nfce(K1)), A, CURRENT, ids('dup2'), null));
    await assertSucceeds(requestDeletion(A, ['dup1', 'dup2']));
    await assertFails(remove(B, 'dup2', K1)); // o registro é da dup1
    await assertSucceeds(remove(B, 'dup2'));
    expect(await registryOf(K1)).toBe('dup1');
    await assertFails(remove(B, 'dup1'));
    await assertSucceeds(remove(B, 'dup1', K1));
  });
});

describe('compra parcelada: um registro por série', () => {
  type Parcel = ReturnType<typeof newInstallmentSeriesData>[number];

  function series(key: string, count: number, firstMonth = CURRENT, seriesId = 'serie1', uid = A): Parcel[] {
    return newInstallmentSeriesData(
      { ...input(uid, nfce(key), `${firstMonth}-05`), totalCents: 480000 },
      { count, firstMonth },
      uid,
      { groupId: GROUP, seriesId },
      serverTime(),
    );
  }

  function createSeries(uid: string, parcels: Parcel[], registerFor?: string | null) {
    const fs = db(uid);
    const batch = fs.batch();
    for (const p of parcels) batch.set(fs.doc(expPath(p.id)), p.data);
    const key = (parcels[0].data.receipt as { nfceKey: string }).nfceKey;
    const seriesId = parcels[0].data.installment.seriesId;
    if (registerFor !== null) batch.set(fs.doc(keyPath(key)), fiscalKeyData(registerFor ?? seriesId, uid, serverTime()));
    return batch.commit();
  }

  it('48 parcelas com chave e o registro da série, num lote (cabe no limite de leituras das regras)', async () => {
    await assertSucceeds(createSeries(A, series(K1, 48)));
    expect(await registryOf(K1)).toBe('serie1');
    await assertFails(create(B, 'e1', nfce(K1)));
  });

  it('o registro aponta para a parcela 1 (a série); sem ele ou para outra parcela, recusado', async () => {
    await assertFails(createSeries(A, series(K1, 3), null));
    await assertFails(createSeries(A, series(K1, 3), 'serie1-2'));
    await seedWithKey('e1', K2);
    await assertFails(createSeries(A, series(K2, 3, CURRENT, 'serie2')));
  });

  it('excluir a série inteira solta a chave', async () => {
    const parcels = series(K1, 3);
    await assertSucceeds(createSeries(A, parcels));
    // Série confirmada: o pedido vale para a série; o outro membro aprova excluindo.
    await assertSucceeds(requestDeletion(A, parcels.map((p) => p.id)));
    const fs = db(B);
    const without = fs.batch();
    for (const p of parcels) without.delete(fs.doc(expPath(p.id)));
    await assertFails(without.commit());
    const batch = fs.batch();
    for (const p of parcels) batch.delete(fs.doc(expPath(p.id)));
    batch.delete(fs.doc(keyPath(K1)));
    await assertSucceeds(batch.commit());
  });

  it('com a parcela 1 em mês fechado, a chave fica com a série', async () => {
    // Série semeada: parcela 1 no mês fechado, 2 e 3 abertas.
    const parcels = series(K1, 3, CLOSED);
    for (const p of parcels) await seed(p.id, p.data);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(keyPath(K1)).set({ expenseId: 'serie1', createdBy: A, createdAt: new Date() });
    });
    const open = parcels.slice(1);
    const fs = db(A);
    const current = { receipt: parcels[0].data.receipt, status: 'confirmed' as const };
    const edit = (receipt: ReceiptChoice, extra?: (b: firebase.firestore.WriteBatch) => void) => {
      const batch = fs.batch();
      for (const p of open) {
        batch.update(
          fs.doc(expPath(p.id)),
          installmentUpdateData(
            { description: 'Geladeira', payerUid: A, payerSharePct: 50, receipt },
            current,
            { groupId: GROUP, seriesId: 'serie1' },
            serverTime(),
            removeField(),
          ),
        );
      }
      extra?.(batch);
      return batch.commit();
    };
    // Trocar para outra chave nas abertas: o registro da antiga é da parcela 1, que não muda.
    await assertFails(edit(nfce(K2), (b) => b.set(fs.doc(keyPath(K2)), fiscalKeyData('serie1', A, serverTime()))));
    await assertFails(edit(nfce(K2), (b) => b.set(fs.doc(keyPath(K2)), fiscalKeyData('serie1', A, serverTime())).delete(fs.doc(keyPath(K1)))));
    // Tirar a chave das abertas é permitido e o registro continua (a parcela 1 usa a chave).
    await assertSucceeds(edit({ type: 'photo', replaced: true }));
    expect(await registryOf(K1)).toBe('serie1');
    await assertFails(db(A).doc(keyPath(K1)).delete());
    // Excluir as parcelas abertas (já confirmadas: pelo pedido) também não solta a chave.
    await assertSucceeds(requestDeletion(A, open.map((p) => p.id)));
    const other = db(B);
    const del = other.batch();
    for (const p of open) del.delete(other.doc(expPath(p.id)));
    await assertSucceeds(del.commit());
    await assertFails(create(B, 'e1', nfce(K1)));
  });
});
