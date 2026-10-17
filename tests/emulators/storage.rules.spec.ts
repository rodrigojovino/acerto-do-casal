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
const PATH = `groups/${GROUP}/receipts/e1.jpg`;

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
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B] });
    await ctx.storage().ref(PATH).put(jpeg(1024), { contentType: 'image/jpeg' });
  });
});

function jpeg(size: number): Uint8Array {
  return new Uint8Array(size);
}

const storageAs = (uid: string) => env.authenticatedContext(uid).storage();

describe('comprovantes no Storage', () => {
  it('membro envia e lê JPEG', async () => {
    await assertSucceeds(storageAs(A).ref(`groups/${GROUP}/receipts/e2.jpg`).put(jpeg(2048), { contentType: 'image/jpeg' }));
    await assertSucceeds(storageAs(B).ref(PATH).getDownloadURL());
  });

  it('não membro e visitante não leem nem enviam', async () => {
    await assertFails(storageAs(C).ref(PATH).getDownloadURL());
    await assertFails(storageAs(C).ref(`groups/${GROUP}/receipts/e3.jpg`).put(jpeg(1024), { contentType: 'image/jpeg' }));
    await assertFails(env.unauthenticatedContext().storage().ref(PATH).getDownloadURL());
  });

  it('recusa outro tipo de arquivo ou nome', async () => {
    await assertFails(storageAs(A).ref(`groups/${GROUP}/receipts/e4.jpg`).put(jpeg(1024), { contentType: 'image/png' }));
    await assertFails(storageAs(A).ref(`groups/${GROUP}/receipts/e4.png`).put(jpeg(1024), { contentType: 'image/jpeg' }));
  });

  it('recusa arquivo de 5 MB ou mais', async () => {
    await assertFails(
      storageAs(A).ref(`groups/${GROUP}/receipts/e5.jpg`).put(jpeg(5 * 1024 * 1024), { contentType: 'image/jpeg' }),
    );
  });

  it('nada fora da pasta de comprovantes', async () => {
    await assertFails(storageAs(A).ref(`groups/${GROUP}/outros/x.jpg`).put(jpeg(10), { contentType: 'image/jpeg' }));
  });
});
