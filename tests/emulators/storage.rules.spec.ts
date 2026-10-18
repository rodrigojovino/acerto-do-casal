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
