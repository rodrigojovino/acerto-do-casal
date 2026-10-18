import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseError } from 'firebase/app';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anonymousCaller, clearAuth, closeApps, createTestEnv, signInAs, type TestUser } from './setup';

interface InviteResult {
  groupId: string;
  code: string;
  expiresAt: number;
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await clearAuth();
});

afterEach(async () => {
  await closeApps();
});

/** Lê o Firestore como o Admin SDK veria, sem regras. */
async function readDoc(path: string): Promise<Record<string, unknown> | undefined> {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await ctx.firestore().doc(path).get()).data();
  });
  return data;
}

async function writeDoc(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data, { merge: true });
  });
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

const raw = (code: string) => code.replace('-', '');

describe('createGroup', () => {
  it('cria o grupo com quem chamou e um código de 24h', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    const before = Date.now();
    const res = await a.call<InviteResult>('createGroup');

    expect(res.code).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
    expect(res.expiresAt - before).toBeGreaterThan(23.9 * 3600_000);
    expect(res.expiresAt - before).toBeLessThanOrEqual(24 * 3600_000 + 60_000);

    const group = await readDoc(`groups/${res.groupId}`);
    expect(group?.members).toEqual([a.uid]);
    expect(group?.memberNames).toEqual({ [a.uid]: 'Pessoa A' });
    expect(group?.defaultSplitPct).toBe(50);
    expect(group?.inviteCode).toBe(raw(res.code));
    expect(await readDoc(`memberships/${a.uid}`)).toEqual({ groupId: res.groupId });
    expect((await readDoc(`invites/${raw(res.code)}`))?.groupId).toBe(res.groupId);
  });

  it('recusa quem já tem grupo', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    await a.call('createGroup');
    await expectError(a.call('createGroup'), 'already-exists', /já faz parte/);
  });

  it('duas chamadas simultâneas criam um grupo só', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    const results = await Promise.allSettled([a.call('createGroup'), a.call('createGroup')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('exige login', async () => {
    await expectError(anonymousCaller()('createGroup'), 'unauthenticated');
  });
});

describe('joinGroup', () => {
  let a: TestUser;
  let b: TestUser;
  let invite: InviteResult;

  beforeEach(async () => {
    a = await signInAs('ana', 'Pessoa A');
    b = await signInAs('bia', 'Pessoa B');
    invite = await a.call<InviteResult>('createGroup');
  });

  it('o segundo membro entra e o convite é consumido', async () => {
    const res = await b.call<{ groupId: string }>('joinGroup', { code: invite.code.toLowerCase() });
    expect(res.groupId).toBe(invite.groupId);

    const group = await readDoc(`groups/${invite.groupId}`);
    expect(group?.members).toEqual([a.uid, b.uid]);
    expect(group?.memberNames).toEqual({ [a.uid]: 'Pessoa A', [b.uid]: 'Pessoa B' });
    expect(group?.inviteCode).toBeNull();
    expect(await readDoc(`memberships/${b.uid}`)).toEqual({ groupId: invite.groupId });
    expect(await readDoc(`invites/${raw(invite.code)}`)).toBeUndefined();
  });

  it('terceira pessoa não entra com o código já usado', async () => {
    await b.call('joinGroup', { code: invite.code });
    const c = await signInAs('caio', 'Pessoa C');
    await expectError(c.call('joinGroup', { code: invite.code }), 'not-found', /inválido/);
  });

  it('terceira pessoa não entra em grupo completo, mesmo com convite válido', async () => {
    await b.call('joinGroup', { code: invite.code });
    // Convite que sobrou apontando para o grupo já completo.
    await writeDoc('invites/ZZZ222', {
      groupId: invite.groupId,
      createdBy: a.uid,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const c = await signInAs('caio', 'Pessoa C');
    await expectError(c.call('joinGroup', { code: 'ZZZ-222' }), 'failed-precondition', /completo/);
    expect((await readDoc(`groups/${invite.groupId}`))?.members).toEqual([a.uid, b.uid]);
    expect(await readDoc(`memberships/${c.uid}`)).toBeUndefined();
  });

  it('código expirado é recusado', async () => {
    await writeDoc(`invites/${raw(invite.code)}`, { expiresAt: new Date(Date.now() - 1000) });
    await expectError(b.call('joinGroup', { code: invite.code }), 'deadline-exceeded', /expirou/);
    expect((await readDoc(`groups/${invite.groupId}`))?.members).toEqual([a.uid]);
  });

  it('quem gerou o código não entra no próprio grupo', async () => {
    await expectError(a.call('joinGroup', { code: invite.code }), 'failed-precondition', /próprio código/);
    expect((await readDoc(`groups/${invite.groupId}`))?.members).toEqual([a.uid]);
  });

  it('se os dois criaram grupo, quem digita o código do outro troca de grupo', async () => {
    const own = await b.call<InviteResult>('createGroup');
    await expect(b.call('joinGroup', { code: invite.code })).resolves.toEqual({ groupId: invite.groupId });

    expect((await readDoc(`groups/${invite.groupId}`))?.members).toEqual([a.uid, b.uid]);
    expect(await readDoc(`memberships/${b.uid}`)).toEqual({ groupId: invite.groupId });
    // O grupo vazio de B e o convite dele somem.
    expect(await readDoc(`groups/${own.groupId}`)).toBeUndefined();
    expect(await readDoc(`invites/${raw(own.code)}`)).toBeUndefined();
  });

  it('quem está num grupo completo não entra em outro', async () => {
    await b.call('joinGroup', { code: invite.code });
    const c = await signInAs('caio', 'Pessoa C');
    const other = await c.call<InviteResult>('createGroup');
    await expectError(b.call('joinGroup', { code: other.code }), 'already-exists');
    expect((await readDoc(`groups/${invite.groupId}`))?.members).toEqual([a.uid, b.uid]);
    expect(await readDoc(`memberships/${b.uid}`)).toEqual({ groupId: invite.groupId });
  });

  it('código inexistente ou mal formatado é recusado', async () => {
    await expectError(b.call('joinGroup', { code: 'ZZZ-ZZZ' }), 'not-found');
    await expectError(b.call('joinGroup', { code: '12' }), 'invalid-argument');
    await expectError(b.call('joinGroup', {}), 'invalid-argument');
  });

  it('bloqueia depois de 10 códigos errados na hora', async () => {
    for (let i = 0; i < 10; i++) {
      await expectError(b.call('joinGroup', { code: 'ZZZ-ZZZ' }), 'not-found');
    }
    // Nem o código certo passa enquanto durar o bloqueio.
    await expectError(b.call('joinGroup', { code: invite.code }), 'resource-exhausted', /Muitas tentativas/);
  });

  it('o bloqueio vence depois de uma hora', async () => {
    await writeDoc(`joinAttempts/${b.uid}`, { failures: 10, windowStart: new Date(Date.now() - 3600_001) });
    await expect(b.call('joinGroup', { code: invite.code })).resolves.toEqual({ groupId: invite.groupId });
  });
});

describe('renewInvite', () => {
  it('gera código novo e invalida o anterior', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    const b = await signInAs('bia', 'Pessoa B');
    const first = await a.call<InviteResult>('createGroup');
    const second = await a.call<InviteResult>('renewInvite');

    expect(second.groupId).toBe(first.groupId);
    expect(second.code).not.toBe(first.code);
    await expectError(b.call('joinGroup', { code: first.code }), 'not-found');
    await expect(b.call('joinGroup', { code: second.code })).resolves.toEqual({ groupId: first.groupId });
  });

  it('recusa grupo completo e quem não tem grupo', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    const b = await signInAs('bia', 'Pessoa B');
    const c = await signInAs('caio', 'Pessoa C');
    const invite = await a.call<InviteResult>('createGroup');
    await b.call('joinGroup', { code: invite.code });
    await expectError(a.call('renewInvite'), 'failed-precondition', /completo/);
    await expectError(c.call('renewInvite'), 'failed-precondition');
  });
});

describe('lookupCnpj', () => {
  // CNPJs fictícios; no emulador a Function responde sem acessar a rede.
  it('quem tem grupo recebe o nome fantasia e o resultado vai para o cache', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    await a.call('createGroup');
    expect(await a.call('lookupCnpj', { cnpj: '11.222.333/0001-81' })).toEqual({ name: 'Mercado Teste' });
    expect(await readDoc('cnpjCache/11222333000181')).toMatchObject({
      name: 'Mercado Teste',
      fantasyName: 'Mercado Teste',
      legalName: 'MERCADO TESTE LTDA',
    });
  });

  it('sem nome fantasia, a razão social; não encontrado devolve null, sem guardar', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    await a.call('createGroup');
    expect(await a.call('lookupCnpj', { cnpj: '11444777000161' })).toEqual({ name: 'FARMACIA EXEMPLO LTDA' });
    // Válido, mas fora das respostas fictícias: "não encontrado".
    expect(await a.call('lookupCnpj', { cnpj: '11222333000262' })).toEqual({ name: null });
    expect(await readDoc('cnpjCache/11222333000262')).toBeUndefined();
  });

  it('usa o cache antes da consulta', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    await a.call('createGroup');
    await writeDoc('cnpjCache/11222333000262', { name: 'Padaria do Cache', fantasyName: 'Padaria do Cache', legalName: null });
    expect(await a.call('lookupCnpj', { cnpj: '11222333000262' })).toEqual({ name: 'Padaria do Cache' });
  });

  it('CNPJ inválido, sem login ou sem grupo: recusado', async () => {
    const a = await signInAs('ana', 'Pessoa A');
    await expectError(a.call('lookupCnpj', { cnpj: '11222333000181' }), 'permission-denied', /grupo/);
    await a.call('createGroup');
    await expectError(a.call('lookupCnpj', { cnpj: '11222333000182' }), 'invalid-argument');
    await expectError(anonymousCaller()('lookupCnpj', { cnpj: '11222333000181' }), 'unauthenticated');
  });

  it('o app não lê nem grava o cache', async () => {
    const fs = env.authenticatedContext('qualquer').firestore();
    await assertFails(fs.doc('cnpjCache/11222333000181').get());
    await assertFails(fs.doc('cnpjCache/11222333000181').set({ name: 'Forjado' }));
  });
});
