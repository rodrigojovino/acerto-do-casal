import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { expenseUpdateData, newExpenseData, type ExpenseInput } from '../../src/services/expenseData';
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
const NEXT = month(1);
const TOO_FAR = month(2);
const CLOSED = month(-2);
const OPEN_PAST = month(-1);

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

function expense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 5000,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    competence: CURRENT,
    receipt: { type: 'none' },
    status: 'pending_approval',
    createdBy: A,
    createdAt: serverTime(),
    updatedAt: serverTime(),
    ...overrides,
  };
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const path = (id: string) => `groups/${GROUP}/expenses/${id}`;

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`groups/${GROUP}`).set({
      members: [A, B],
      memberNames: { [A]: 'Pessoa A', [B]: 'Pessoa B' },
      defaultSplitPct: 50,
    });
    await db.doc(`groups/${GROUP}/months/${CLOSED}`).set({ status: 'closed' });
    // Gasto de A no mês atual e gasto de A num mês fechado.
    await db.doc(path('a-atual')).set(expense({ createdAt: new Date(), updatedAt: new Date() }));
    await db
      .doc(path('a-fechado'))
      .set(expense({ date: `${CLOSED}-10`, competence: CLOSED, createdAt: new Date(), updatedAt: new Date() }));
  });
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();

/** Edição como o app faz: todos os campos, updatedAt do servidor. */
function edit(uid: string, id: string, changes: Record<string, unknown>) {
  return db(uid).doc(path(id)).update({ ...changes, updatedAt: serverTime() });
}

describe('leitura', () => {
  it('membros leem, terceiro e visitante não', async () => {
    await assertSucceeds(db(A).doc(path('a-atual')).get());
    await assertSucceeds(db(B).collection(`groups/${GROUP}/expenses`).where('competence', '==', CURRENT).get());
    await assertFails(db(C).doc(path('a-atual')).get());
    await assertFails(db(C).collection(`groups/${GROUP}/expenses`).get());
    await assertFails(env.unauthenticatedContext().firestore().doc(path('a-atual')).get());
  });
});

describe('criação', () => {
  it('membro lança gasto válido, pago por ele ou pelo outro', async () => {
    await assertSucceeds(db(A).doc(path('n1')).set(expense()));
    await assertSucceeds(db(A).doc(path('n2')).set(expense({ payerUid: B, personalCents: 0, payerSharePct: 70 })));
    await assertSucceeds(db(B).doc(path('n3')).set(expense({ createdBy: B, payerUid: B })));
  });

  it('aceita pessoal igual ao total e divisões 0 e 100', async () => {
    await assertSucceeds(db(A).doc(path('n4')).set(expense({ personalCents: 20000 })));
    await assertSucceeds(db(A).doc(path('n5')).set(expense({ payerSharePct: 0 })));
    await assertSucceeds(db(A).doc(path('n6')).set(expense({ payerSharePct: 100 })));
  });

  it('terceiro e visitante não lançam', async () => {
    await assertFails(db(C).doc(path('x')).set(expense({ createdBy: C, payerUid: C })));
    await assertFails(db(C).doc(path('x')).set(expense()));
    await assertFails(env.unauthenticatedContext().firestore().doc(path('x')).set(expense()));
  });

  it('não lança em nome do outro', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ createdBy: B })));
  });

  it('recusa valores fora de centavos inteiros', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ totalCents: 200.5 })));
    await assertFails(db(A).doc(path('x')).set(expense({ totalCents: '20000' })));
    await assertFails(db(A).doc(path('x')).set(expense({ totalCents: 0 })));
    await assertFails(db(A).doc(path('x')).set(expense({ totalCents: -100 })));
    await assertFails(db(A).doc(path('x')).set(expense({ personalCents: -1 })));
    await assertFails(db(A).doc(path('x')).set(expense({ personalCents: 10.5 })));
  });

  it('recusa parte pessoal maior que o total', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ personalCents: 20001 })));
  });

  it('recusa divisão fora de 0 a 100 ou não inteira', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ payerSharePct: 101 })));
    await assertFails(db(A).doc(path('x')).set(expense({ payerSharePct: -5 })));
    await assertFails(db(A).doc(path('x')).set(expense({ payerSharePct: 33.3 })));
  });

  it('recusa pagador de fora do grupo', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ payerUid: C })));
  });

  it('recusa descrição vazia ou longa demais', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ description: '   ' })));
    await assertFails(db(A).doc(path('x')).set(expense({ description: 'x'.repeat(81) })));
  });

  it('recusa campo extra ou faltando', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ approvedBy: A })));
    const missing = expense();
    delete missing.personalCents;
    await assertFails(db(A).doc(path('x')).set(missing));
  });

  it('não pula a aprovação: nasce pendente e sem comprovante', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ status: 'confirmed' })));
    await assertFails(db(A).doc(path('x')).set(expense({ receipt: { type: 'photo', photoPath: 'x.jpg' } })));
  });

  it('exige horário do servidor', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ createdAt: new Date(2020, 0, 1) })));
  });

  it('recusa data mal formatada', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ date: '05/10/2026' })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${CURRENT}-32` })));
  });

  it('data futura só até o fim do mês seguinte', async () => {
    await assertSucceeds(db(A).doc(path('n7')).set(expense({ date: `${NEXT}-28`, competence: NEXT })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${TOO_FAR}-01`, competence: TOO_FAR })));
  });

  it('competência é o mês da data', async () => {
    await assertSucceeds(db(A).doc(path('n8')).set(expense({ date: `${OPEN_PAST}-20`, competence: OPEN_PAST })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${OPEN_PAST}-20`, competence: CURRENT })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${CURRENT}-05`, competence: OPEN_PAST })));
  });

  it('data de mês fechado entra num mês aberto posterior, nunca no fechado', async () => {
    await assertSucceeds(db(A).doc(path('n9')).set(expense({ date: `${CLOSED}-15`, competence: CURRENT })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${CLOSED}-15`, competence: CLOSED })));
    await assertFails(db(A).doc(path('x')).set(expense({ date: `${CURRENT}-05`, competence: CLOSED })));
  });
});

describe('edição', () => {
  it('quem lançou edita', async () => {
    await assertSucceeds(edit(A, 'a-atual', { totalCents: 25000, description: 'Mercado do mês' }));
  });

  it('o outro membro e terceiros não editam', async () => {
    await assertFails(edit(B, 'a-atual', { totalCents: 1 }));
    await assertFails(edit(C, 'a-atual', { totalCents: 1 }));
  });

  it('não aprova o próprio gasto nem troca o autor', async () => {
    await assertFails(edit(A, 'a-atual', { status: 'confirmed' }));
    await assertFails(edit(A, 'a-atual', { createdBy: B }));
    await assertFails(edit(A, 'a-atual', { createdAt: new Date() }));
  });

  it('edição continua validando valores', async () => {
    await assertFails(edit(A, 'a-atual', { personalCents: 30000 }));
    await assertFails(edit(A, 'a-atual', { payerUid: C }));
    await assertFails(edit(A, 'a-atual', { extra: true }));
  });

  it('gasto devolvido volta a pendente ao ser corrigido', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-atual')).update({ status: 'returned' });
    });
    await assertSucceeds(edit(A, 'a-atual', { status: 'pending_approval', totalCents: 19000 }));
  });

  it('gasto de mês fechado é imutável', async () => {
    await assertFails(edit(A, 'a-fechado', { description: 'Outro' }));
  });

  it('não move gasto para um mês fechado', async () => {
    await assertFails(edit(A, 'a-atual', { date: `${CLOSED}-10`, competence: CLOSED }));
  });
});

describe('exclusão', () => {
  it('quem lançou exclui', async () => {
    await assertSucceeds(db(A).doc(path('a-atual')).delete());
  });

  it('o outro membro e terceiros não excluem', async () => {
    await assertFails(db(B).doc(path('a-atual')).delete());
    await assertFails(db(C).doc(path('a-atual')).delete());
  });

  it('não exclui gasto de mês fechado', async () => {
    await assertFails(db(A).doc(path('a-fechado')).delete());
  });
});

// Os documentos exatamente como o app grava (src/services/expenseData.ts).
describe('documentos montados pelo app', () => {
  const input: ExpenseInput = {
    description: '  Farmácia  ',
    totalCents: 8000,
    personalCents: 0,
    payerUid: B,
    payerSharePct: 50,
    date: `${CURRENT}-14`,
    receipt: { type: 'none' },
  };
  const removeField = () => firebase.firestore.FieldValue.delete();

  it('o gasto novo do app passa nas regras', async () => {
    const ids = { groupId: GROUP, expenseId: 'app-1' };
    await assertSucceeds(db(A).doc(path('app-1')).set(newExpenseData(input, A, CURRENT, ids, serverTime())));
  });

  it('a edição do app passa nas regras, inclusive devolvido corrigido', async () => {
    const changed = { ...input, totalCents: 9000 };
    const ids = { groupId: GROUP, expenseId: 'a-atual' };
    const update = () => expenseUpdateData(changed, CURRENT, ids, { type: 'none' }, serverTime(), removeField());
    await assertSucceeds(db(A).doc(path('a-atual')).update(update()));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-atual')).update({ status: 'returned' });
    });
    await assertSucceeds(db(A).doc(path('a-atual')).update(update()));
  });
});
