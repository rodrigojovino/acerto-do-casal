import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DEFAULT_FRAMING } from '../../src/domain/cover';
import { coverData, coverFramingData, type CoverImage } from '../../src/services/coverData';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// Foto do casal no cartão de saldo (groups/{g}/cover/current).
// UIDs fictícios: A e B são o casal, C é um terceiro. Imagem fictícia (base64 de JPEG).
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';
const PATH = `groups/${GROUP}/cover/current`;

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const photo: CoverImage = { image: `/9j/${'A'.repeat(400)}==`, width: 1600, height: 1200 };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});

afterAll(async () => {
  await env.cleanup();
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const valid = (uid = A) => coverData(photo, DEFAULT_FRAMING, uid, serverTime());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`groups/${GROUP}`).set({ members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  });
});

describe('foto do cartão', () => {
  it('qualquer membro põe, ajusta e remove; o outro também', async () => {
    await assertSucceeds(db(A).doc(PATH).set(valid()));
    await assertSucceeds(db(B).doc(PATH).get());
    await assertSucceeds(db(B).doc(PATH).update(coverFramingData({ x: 0.2, y: 0.8, zoom: 2.5, dark: 0.75, blur: 2 }, B, serverTime())));
    await assertSucceeds(db(B).doc(PATH).set(valid(B)));
    await assertSucceeds(db(A).doc(PATH).delete());
  });

  it('terceiro não lê, não grava e não remove', async () => {
    await assertSucceeds(db(A).doc(PATH).set(valid()));
    await assertFails(db(C).doc(PATH).get());
    await assertFails(db(C).doc(PATH).set(valid(C)));
    await assertFails(db(C).doc(PATH).delete());
  });

  it('só o documento "current"', async () => {
    await assertFails(db(A).doc(`groups/${GROUP}/cover/outra`).set(valid()));
  });

  it('imagem: JPEG em base64, no tamanho permitido', async () => {
    const at = (image: string) => db(A).doc(PATH).set({ ...valid(), image });
    await assertFails(at(`iVBORw0KGgo${'A'.repeat(400)}`)); // PNG
    await assertFails(at('/9j/AAAA')); // pequena demais
    await assertFails(at(`/9j/${'A'.repeat(600_000)}`)); // grande demais
    await assertFails(at(`/9j/${'A'.repeat(200)}<script>`)); // fora do base64
    await assertSucceeds(at(`/9j/${'A'.repeat(500_000)}`));
  });

  it('foto exatamente no limite (600.000 caracteres) cabe no documento (máximo de 1 MiB do Firestore)', async () => {
    const image = `/9j/${'A'.repeat(600_000 - 4)}`;
    await assertSucceeds(db(A).doc(PATH).set({ ...valid(), image }));
    await assertFails(db(A).doc(PATH).set({ ...valid(), image: `${image}A` }));
  });

  it('limites do enquadramento, do escurecimento e do desfoque', async () => {
    const at = (over: Record<string, unknown>) => db(A).doc(PATH).set({ ...valid(), ...over });
    await assertFails(at({ x: -0.1 }));
    await assertFails(at({ y: 1.2 }));
    await assertFails(at({ zoom: 0.9 }));
    await assertFails(at({ zoom: 3.5 }));
    await assertFails(at({ dark: 0.39 }));
    await assertFails(at({ dark: 0.91 }));
    await assertFails(at({ blur: 3 }));
    await assertFails(at({ blur: 1.5 }));
    await assertFails(at({ width: 0 }));
    await assertFails(at({ x: '0.5' }));
    await assertSucceeds(at({ x: 0, y: 1, zoom: 3, dark: 0.4, blur: 0 }));
    await assertSucceeds(at({ x: 1, y: 0, zoom: 1, dark: 0.9, blur: 2 }));
  });

  it('autor e horário do servidor; nada a mais', async () => {
    await assertFails(db(A).doc(PATH).set(valid(B)));
    await assertFails(db(A).doc(PATH).set({ ...valid(), updatedAt: new Date() }));
    await assertFails(db(A).doc(PATH).set({ ...valid(), legenda: 'nós' }));
    await assertSucceeds(db(A).doc(PATH).set(valid()));
    await assertFails(db(B).doc(PATH).update({ dark: 0.8 })); // sem autor e horário novos
  });
});
