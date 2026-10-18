import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  newRecurringData,
  recurringApprovalData,
  recurringDeactivateData,
  recurringRejectionData,
  recurringUpdateData,
  type RecurringInput,
} from '../../src/services/recurringData';
import { createTestEnv } from './setup';

// UIDs fictícios: A e B são o casal, C é um terceiro.
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

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();

const fixed: RecurringInput = {
  description: 'Internet',
  kind: 'fixed',
  amountCents: 12000,
  dayOfMonth: 10,
  payerUid: A,
  payerSharePct: 50,
  startMonth: CURRENT,
};
const variable: RecurringInput = { ...fixed, description: 'Luz', kind: 'variable', amountCents: undefined };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const recPath = (id: string) => `groups/${GROUP}/recurring/${id}`;
const expPath = (id: string) => `groups/${GROUP}/expenses/${id}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();

/** Semeia sem regras; campos `undefined` são omitidos. */
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(clean);
  });
}

const stored = (input: RecurringInput, extra: Record<string, unknown> = {}) => ({
  ...input,
  active: true,
  status: 'approved',
  createdBy: A,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(`groups/${GROUP}`, { members: [A, B], memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' }, defaultSplitPct: 50 });
  await seed(recPath('fixo-pendente'), stored(fixed, { status: 'pending_approval' }));
  await seed(recPath('fixo-aprovado'), stored(fixed, { approval: { byUid: B, at: new Date() }, lastGeneratedMonth: CURRENT }));
  await seed(recPath('fixo-devolvido'), stored(fixed, { status: 'returned', rejection: { byUid: B, at: new Date(), kind: 'reject' } }));
  await seed(recPath('variavel'), stored(variable));
});

describe('cadastro', () => {
  it('membros leem; terceiro não', async () => {
    await assertSucceeds(db(B).doc(recPath('fixo-pendente')).get());
    await assertFails(db(C).doc(recPath('fixo-pendente')).get());
  });

  it('fixo nasce pendente de aprovação; variável já nasce aprovado (como o app grava)', async () => {
    await assertSucceeds(db(A).doc(recPath('n1')).set(newRecurringData(fixed, A, serverTime())));
    await assertSucceeds(db(A).doc(recPath('n2')).set(newRecurringData(variable, A, serverTime())));
  });

  it('fixo não nasce aprovado (gerar recorrente sem aprovação)', async () => {
    await assertFails(db(A).doc(recPath('x')).set({ ...newRecurringData(fixed, A, serverTime()), status: 'approved' }));
    await assertFails(
      db(A).doc(recPath('x')).set({ ...newRecurringData(fixed, A, serverTime()), status: 'approved', approval: { byUid: B, at: serverTime() } }),
    );
  });

  it('não forja lastGeneratedMonth nem cadastra em nome do outro ou de terceiro', async () => {
    await assertFails(db(A).doc(recPath('x')).set({ ...newRecurringData(fixed, A, serverTime()), lastGeneratedMonth: CURRENT }));
    await assertFails(db(A).doc(recPath('x')).set(newRecurringData(fixed, B, serverTime())));
    await assertFails(db(C).doc(recPath('x')).set(newRecurringData({ ...fixed, payerUid: C }, C, serverTime())));
  });

  it('valida valores: fixo com valor inteiro > 0, variável sem valor, dia 1 a 31, mês final >= inicial', async () => {
    const base = newRecurringData(fixed, A, serverTime());
    await assertFails(db(A).doc(recPath('x')).set({ ...base, amountCents: 0 }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, amountCents: 10.5 }));
    await assertFails(db(A).doc(recPath('x')).set({ ...newRecurringData(variable, A, serverTime()), amountCents: 500 }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, dayOfMonth: 32 }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, dayOfMonth: 0 }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, endMonth: '2020-01' }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, payerUid: C }));
    await assertFails(db(A).doc(recPath('x')).set({ ...base, payerSharePct: 101 }));
  });
});

describe('aprovação do fixo', () => {
  it('o outro membro aprova ou recusa', async () => {
    await assertSucceeds(db(B).doc(recPath('fixo-pendente')).update(recurringApprovalData(B, serverTime())));
  });

  it('recusa com motivo', async () => {
    await assertSucceeds(db(B).doc(recPath('fixo-pendente')).update(recurringRejectionData(B, 'Valor errado', serverTime())));
  });

  it('não aprova o próprio cadastro; terceiro não aprova', async () => {
    await assertFails(db(A).doc(recPath('fixo-pendente')).update(recurringApprovalData(A, serverTime())));
    await assertFails(db(C).doc(recPath('fixo-pendente')).update(recurringApprovalData(C, serverTime())));
  });

  it('quem aprova não altera o cadastro', async () => {
    await assertFails(db(B).doc(recPath('fixo-pendente')).update({ ...recurringApprovalData(B, serverTime()), amountCents: 1 }));
  });
});

describe('edição por quem cadastrou', () => {
  const current = { kind: 'fixed' as const, amountCents: 12000, payerUid: A, payerSharePct: 50, status: 'approved' as const };

  it('descrição, dia e mês final não exigem nova aprovação (mantém aprovado e a aprovação)', async () => {
    const changed = { ...fixed, description: 'Internet fibra', dayOfMonth: 15, endMonth: month(6) };
    const data = recurringUpdateData(changed, current, true, serverTime(), removeField());
    if (data.status !== 'approved') throw new Error('deveria manter aprovado');
    await assertSucceeds(db(A).doc(recPath('fixo-aprovado')).update(data));
  });

  it('valor, quem paga, divisão ou tipo exigem nova aprovação', async () => {
    for (const changed of [
      { ...fixed, amountCents: 13000 },
      { ...fixed, payerUid: B },
      { ...fixed, payerSharePct: 60 },
    ]) {
      const data = recurringUpdateData(changed, current, true, serverTime(), removeField());
      if (data.status !== 'pending_approval') throw new Error('deveria ir para aprovação');
      await assertSucceeds(db(A).doc(recPath('fixo-aprovado')).update(data));
      await seed(recPath('fixo-aprovado'), stored(fixed, { approval: { byUid: B, at: new Date() }, lastGeneratedMonth: CURRENT }));
    }
  });

  it('mudar o valor mantendo aprovado é recusado', async () => {
    await assertFails(db(A).doc(recPath('fixo-aprovado')).update({ amountCents: 99999, updatedAt: serverTime() }));
    await assertFails(
      db(A).doc(recPath('fixo-aprovado')).update({ amountCents: 99999, approval: removeField(), updatedAt: serverTime() }),
    );
  });

  it('mudar para variável dispensa aprovação; para fixo exige', async () => {
    const toVariable = recurringUpdateData(variable, current, true, serverTime(), removeField());
    await assertSucceeds(db(A).doc(recPath('fixo-aprovado')).update(toVariable));
    const fromVariable = { kind: 'variable' as const, payerUid: A, payerSharePct: 50, status: 'approved' as const };
    const toFixed = recurringUpdateData(fixed, fromVariable, true, serverTime(), removeField());
    if (toFixed.status !== 'pending_approval') throw new Error('virar fixo deveria ir para aprovação');
    await assertSucceeds(db(A).doc(recPath('variavel')).update(toFixed));
  });

  it('devolvido corrigido vai para aprovação', async () => {
    const data = recurringUpdateData({ ...fixed, amountCents: 11000 }, { ...current, status: 'returned' }, true, serverTime(), removeField());
    await assertSucceeds(db(A).doc(recPath('fixo-devolvido')).update(data));
  });

  it('o outro membro não edita; ninguém mexe em lastGeneratedMonth', async () => {
    await assertFails(db(B).doc(recPath('fixo-aprovado')).update({ description: 'Outro', updatedAt: serverTime() }));
    await assertFails(db(A).doc(recPath('fixo-aprovado')).update({ lastGeneratedMonth: '2020-01', updatedAt: serverTime() }));
  });
});

describe('desativar e excluir', () => {
  it('qualquer um dos dois desativa; terceiro não', async () => {
    await assertSucceeds(db(B).doc(recPath('fixo-aprovado')).update(recurringDeactivateData(serverTime())));
    await assertSucceeds(db(A).doc(recPath('variavel')).update(recurringDeactivateData(serverTime())));
    await assertFails(db(C).doc(recPath('fixo-pendente')).update(recurringDeactivateData(serverTime())));
  });

  it('o outro membro não reativa (só quem cadastrou, editando)', async () => {
    await seed(recPath('off'), stored(fixed, { active: false, approval: { byUid: B, at: new Date() } }));
    await assertFails(db(B).doc(recPath('off')).update({ active: true, updatedAt: serverTime() }));
    const data = recurringUpdateData(fixed, { kind: 'fixed', amountCents: 12000, payerUid: A, payerSharePct: 50, status: 'approved' }, true, serverTime(), removeField());
    await assertSucceeds(db(A).doc(recPath('off')).update(data));
  });

  it('só quem cadastrou exclui', async () => {
    await assertFails(db(B).doc(recPath('variavel')).delete());
    await assertSucceeds(db(A).doc(recPath('variavel')).delete());
  });
});

describe('gastos gerados', () => {
  const generated = (extra: Record<string, unknown>) => ({
    description: 'Luz',
    totalCents: 0,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-10`,
    competence: CURRENT,
    receipt: { type: 'none' },
    status: 'awaiting_confirmation',
    createdBy: A,
    createdAt: new Date(),
    updatedAt: new Date(),
    recurringId: 'variavel',
    ...extra,
  });

  it('o app não cria gasto com recurringId', async () => {
    await assertFails(
      db(A).doc(expPath('x')).set({ ...generated({}), status: 'pending_approval', totalCents: 100, createdAt: serverTime(), updatedAt: serverTime() }),
    );
  });

  it('quem paga confirma o valor do variável: sem comprovante, vai para aprovação', async () => {
    await seed(expPath('v'), generated({}));
    await assertFails(db(A).doc(expPath('v')).update({ totalCents: 0, status: 'pending_approval', updatedAt: serverTime() }));
    await assertFails(db(A).doc(expPath('v')).update({ totalCents: 9000, status: 'confirmed', updatedAt: serverTime() }));
    await assertSucceeds(db(A).doc(expPath('v')).update({ totalCents: 9000, status: 'pending_approval', updatedAt: serverTime() }));
  });

  it('o outro membro não confirma nem aprova um aguardando confirmação', async () => {
    await seed(expPath('v'), generated({}));
    await assertFails(db(B).doc(expPath('v')).update({ totalCents: 9000, status: 'pending_approval', updatedAt: serverTime() }));
    await assertFails(
      db(B).doc(expPath('v')).update({ status: 'confirmed', approval: { byUid: B, at: serverTime() }, updatedAt: serverTime() }),
    );
  });

  it('editar não muda nem apaga o recurringId', async () => {
    await seed(expPath('v'), generated({}));
    await assertFails(
      db(A).doc(expPath('v')).update({ totalCents: 9000, status: 'pending_approval', recurringId: 'outro', updatedAt: serverTime() }),
    );
    await assertFails(
      db(A).doc(expPath('v')).update({ totalCents: 9000, status: 'pending_approval', recurringId: removeField(), updatedAt: serverTime() }),
    );
  });

  it('fixo gerado (confirmado sem aprovação): o outro contesta; editar volta a pendente', async () => {
    await seed(expPath('f'), generated({ description: 'Internet', totalCents: 12000, status: 'confirmed', recurringId: 'fixo-aprovado' }));
    await assertFails(db(A).doc(expPath('f')).update({ description: 'Internet fibra', updatedAt: serverTime() }));
    await assertSucceeds(db(A).doc(expPath('f')).update({ description: 'Internet fibra', status: 'pending_approval', updatedAt: serverTime() }));
    await seed(expPath('f2'), generated({ description: 'Internet', totalCents: 12000, status: 'confirmed', recurringId: 'fixo-aprovado' }));
    await assertSucceeds(
      db(B).doc(expPath('f2')).update({
        status: 'returned',
        rejection: { byUid: B, at: serverTime(), kind: 'contest', reason: 'Mudou de plano' },
        updatedAt: serverTime(),
      }),
    );
  });
});
