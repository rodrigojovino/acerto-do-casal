import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv } from './setup';

const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';
const receipt = (id: string) => `groups/${GROUP}/receipts/${id}.jpg`;

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`groups/${GROUP}`).set({ members: [A, B] });
    const photo = (id: string) => ({ type: 'photo', photoPath: receipt(id), photoUploaded: false });
    await db.doc(`groups/${GROUP}/expenses/foto-a`).set({ createdBy: A, receipt: photo('foto-a') });
    await db.doc(`groups/${GROUP}/expenses/foto-b`).set({ createdBy: B, receipt: photo('foto-b') });
    await db.doc(`groups/${GROUP}/expenses/sem-a`).set({ createdBy: A, receipt: { type: 'none' } });
    await ctx.storage().ref(receipt('foto-b')).put(jpeg(1024), { contentType: 'image/jpeg' });
  });
});

function jpeg(size: number): Uint8Array {
  return new Uint8Array(size);
}

const storageAs = (uid: string) => env.authenticatedContext(uid).storage();
const put = (uid: string, path: string, size = 2048, contentType = 'image/jpeg') =>
  storageAs(uid).ref(path).put(jpeg(size), { contentType });

describe('envio da foto', () => {
  it('quem lançou envia e troca a foto do próprio gasto', async () => {
    await assertSucceeds(put(A, receipt('foto-a')));
    await assertSucceeds(put(A, receipt('foto-a'), 4096));
  });

  it('o outro membro não envia foto para gasto alheio', async () => {
    await assertFails(put(A, receipt('foto-b')));
    await assertFails(put(B, receipt('foto-a')));
  });

  it('terceiro e visitante não enviam', async () => {
    await assertFails(put(C, receipt('foto-a')));
    await assertFails(env.unauthenticatedContext().storage().ref(receipt('foto-a')).put(jpeg(10), { contentType: 'image/jpeg' }));
  });

  it('gasto sem comprovante do tipo foto, ou inexistente, não recebe foto', async () => {
    await assertFails(put(A, receipt('sem-a')));
    await assertFails(put(A, receipt('nao-existe')));
  });

  it('recusa outro tipo, outro nome e 1 MB ou mais', async () => {
    await assertFails(put(A, receipt('foto-a'), 2048, 'image/png'));
    await assertFails(put(A, `groups/${GROUP}/receipts/foto-a.png`));
    await assertFails(put(A, receipt('foto-a'), 1024 * 1024));
  });

  it('nada fora da pasta de comprovantes', async () => {
    await assertFails(put(A, `groups/${GROUP}/outros/x.jpg`));
  });

  it('a foto do cartão de saldo não vai para o Storage (fica no Firestore, cover/current)', async () => {
    await assertFails(put(A, `groups/${GROUP}/cover/current.jpg`));
    await assertFails(put(B, `groups/${GROUP}/cover/foto.jpg`));
  });
});

describe('leitura e exclusão', () => {
  it('os dois membros leem; terceiro e visitante não', async () => {
    await assertSucceeds(storageAs(A).ref(receipt('foto-b')).getDownloadURL());
    await assertSucceeds(storageAs(B).ref(receipt('foto-b')).getDownloadURL());
    await assertFails(storageAs(C).ref(receipt('foto-b')).getDownloadURL());
    await assertFails(env.unauthenticatedContext().storage().ref(receipt('foto-b')).getDownloadURL());
  });

  it('só quem lançou apaga a foto', async () => {
    await assertFails(storageAs(A).ref(receipt('foto-b')).delete());
    await assertSucceeds(storageAs(B).ref(receipt('foto-b')).delete());
  });
});

describe('foto da nota junto com a chave', () => {
  const key = '31' + '2'.repeat(18) + '55' + '3'.repeat(22);

  it('quem lançou envia a foto da nota quando a chave tem foto anexada; sem foto anexada, não', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc(`groups/${GROUP}/expenses/chave-foto`).set({
        createdBy: A,
        receipt: { type: 'nfce', nfceKey: key, entry: 'read', nfceStatus: 'unchecked', photoPath: receipt('chave-foto'), photoUploaded: false },
      });
      await db.doc(`groups/${GROUP}/expenses/chave-sem`).set({
        createdBy: A,
        receipt: { type: 'nfce', nfceKey: key, entry: 'read', nfceStatus: 'unchecked' },
      });
    });
    const put = (uid: string, id: string) =>
      env.authenticatedContext(uid).storage().ref(receipt(id)).put(jpeg(2048), { contentType: 'image/jpeg' });
    await assertSucceeds(put(A, 'chave-foto'));
    await assertFails(put(B, 'chave-foto'));
    await assertFails(put(A, 'chave-sem'));
  });

  it('os dois membros leem a foto da nota; terceiro e visitante não; só quem lançou apaga', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}/expenses/nota-b`).set({
        createdBy: B,
        receipt: { type: 'nfce', nfceKey: key, entry: 'qr', nfceStatus: 'unchecked', photoPath: receipt('nota-b'), photoUploaded: true },
      });
      await ctx.storage().ref(receipt('nota-b')).put(jpeg(1024), { contentType: 'image/jpeg' });
    });
    await assertSucceeds(storageAs(A).ref(receipt('nota-b')).getDownloadURL());
    await assertSucceeds(storageAs(B).ref(receipt('nota-b')).getDownloadURL());
    await assertFails(storageAs(C).ref(receipt('nota-b')).getDownloadURL());
    await assertFails(env.unauthenticatedContext().storage().ref(receipt('nota-b')).getDownloadURL());
    await assertFails(storageAs(A).ref(receipt('nota-b')).delete());
    await assertSucceeds(storageAs(B).ref(receipt('nota-b')).delete());
  });
});

describe('comprovante PIX do acerto', () => {
  const MONTH = '2026-09';
  const pix = (id: string, month = MONTH) => `groups/${GROUP}/settlements/${month}/${id}.jpg`;
  const put = (uid: string, path: string, size = 2048, contentType = 'image/jpeg') =>
    env.authenticatedContext(uid).storage().ref(path).put(jpeg(size), { contentType });

  it('membros enviam e leem enquanto o mês está aberto; terceiro não', async () => {
    await assertSucceeds(put(A, pix('pagamento0001')));
    await assertSucceeds(env.authenticatedContext(B).storage().ref(pix('pagamento0001')).getMetadata());
    await assertFails(put(C, pix('pagamento0002')));
    await assertFails(env.authenticatedContext(C).storage().ref(pix('pagamento0001')).getMetadata());
    // Visitante (sem login) também não lê.
    await assertFails(env.unauthenticatedContext().storage().ref(pix('pagamento0001')).getMetadata());
  });

  it('mês fechado não recebe comprovante; nem troca, nem apaga, nem arquivo fora do padrão', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`groups/${GROUP}/months/2026-08`).set({ status: 'closed' });
    });
    await assertFails(put(A, pix('pagamento0003', '2026-08')));
    await assertSucceeds(put(A, pix('pagamento0004')));
    await assertFails(put(A, pix('pagamento0004')));
    await assertFails(env.authenticatedContext(A).storage().ref(pix('pagamento0004')).delete());
    await assertFails(put(A, pix('curto')));
    await assertFails(put(A, pix('pagamento0005'), 2048, 'image/png'));
    await assertFails(put(A, pix('pagamento0006'), 2 * 1024 * 1024));
  });
});
