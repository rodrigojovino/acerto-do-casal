import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { RULES_PROJECT_ID, createTestEnv } from './setup';

// UIDs fictícios: A e B são o casal, C é um terceiro.
const A = 'uid-a';
const B = 'uid-b';
const C = 'uid-c';
const GROUP = 'group-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv(RULES_PROJECT_ID);
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`groups/${GROUP}`).set({
      members: [A, B],
      memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' },
      defaultSplitPct: 50,
      inviteCode: null,
      inviteExpiresAt: null,
    });
    await db.doc(`groups/${GROUP}/expenses/e1`).set({ description: 'Mercado', totalCents: 20000 });
    await db.doc(`memberships/${A}`).set({ groupId: GROUP });
    await db.doc(`memberships/${B}`).set({ groupId: GROUP });
    await db.doc('invites/K7Q4M2').set({ groupId: GROUP, createdBy: A, expiresAt: new Date() });
    await db.doc(`joinAttempts/${C}`).set({ failures: 1, windowStart: new Date() });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('groups', () => {
  it('membro lê o grupo', async () => {
    await assertSucceeds(as(A).doc(`groups/${GROUP}`).get());
    await assertSucceeds(as(B).doc(`groups/${GROUP}`).get());
  });

  it('não membro e visitante sem login não leem o grupo', async () => {
    await assertFails(as(C).doc(`groups/${GROUP}`).get());
    await assertFails(anon().doc(`groups/${GROUP}`).get());
  });

  it('ninguém cria ou apaga grupo pelo app', async () => {
    await assertFails(as(C).doc('groups/novo').set({ members: [C], memberNames: { [C]: 'C' }, defaultSplitPct: 50 }));
    await assertFails(as(A).doc(`groups/${GROUP}`).delete());
  });

  it('membro altera a divisão padrão e o próprio nome', async () => {
    await assertSucceeds(as(A).doc(`groups/${GROUP}`).update({ defaultSplitPct: 60 }));
    await assertSucceeds(as(A).doc(`groups/${GROUP}`).update({ [`memberNames.${A}`]: 'Novo nome' }));
  });

  it('membro não altera a lista de membros nem o convite', async () => {
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ members: [A, C] }));
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ members: [A] }));
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ inviteCode: 'ABCDEF' }));
  });

  it('membro não altera o nome do outro', async () => {
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ [`memberNames.${B}`]: 'Outro' }));
  });

  it('divisão padrão fora de 0 a 100 ou não inteira é recusada', async () => {
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ defaultSplitPct: 150 }));
    await assertFails(as(A).doc(`groups/${GROUP}`).update({ defaultSplitPct: 49.5 }));
  });

  it('terceiro não altera o grupo', async () => {
    await assertFails(as(C).doc(`groups/${GROUP}`).update({ defaultSplitPct: 60 }));
  });
});

describe('subcoleções do grupo', () => {
  it('membro lê gastos e meses', async () => {
    await assertSucceeds(as(B).doc(`groups/${GROUP}/expenses/e1`).get());
    await assertSucceeds(as(B).doc(`groups/${GROUP}/months/2026-09`).get());
  });

  it('não membro não lê nem escreve', async () => {
    await assertFails(as(C).doc(`groups/${GROUP}/expenses/e1`).get());
    await assertFails(as(C).collection(`groups/${GROUP}/expenses`).get());
    await assertFails(as(C).doc(`groups/${GROUP}/expenses/e3`).set({ description: 'Invasão' }));
    await assertFails(anon().doc(`groups/${GROUP}/expenses/e1`).get());
  });

  it('ninguém escreve meses pelo app', async () => {
    await assertFails(as(A).doc(`groups/${GROUP}/months/2026-09`).set({ status: 'closed' }));
  });

  it('subcoleções sem regra própria ficam fechadas, mesmo para membros', async () => {
    await assertFails(as(A).doc(`groups/${GROUP}/qualquer/x`).get());
    await assertFails(as(A).doc(`groups/${GROUP}/qualquer/x`).set({ a: 1 }));
  });
});

describe('memberships', () => {
  it('cada um lê só o próprio vínculo', async () => {
    await assertSucceeds(as(A).doc(`memberships/${A}`).get());
    await assertFails(as(C).doc(`memberships/${A}`).get());
  });

  it('ninguém escreve vínculo pelo app', async () => {
    await assertFails(as(C).doc(`memberships/${C}`).set({ groupId: GROUP }));
    await assertFails(as(A).doc(`memberships/${A}`).delete());
  });
});

describe('coleções só das Functions', () => {
  it('convites não são lidos nem escritos pelo app, nem por membros', async () => {
    await assertFails(as(A).doc('invites/K7Q4M2').get());
    await assertFails(as(C).doc('invites/K7Q4M2').get());
    await assertFails(as(C).collection('invites').get());
    await assertFails(as(C).doc('invites/ZZZZZZ').set({ groupId: GROUP, createdBy: C }));
  });

  it('contador de tentativas não é lido nem zerado pelo app', async () => {
    await assertFails(as(C).doc(`joinAttempts/${C}`).get());
    await assertFails(as(C).doc(`joinAttempts/${C}`).delete());
  });
});
