import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  approvalData,
  expenseUpdateData,
  newExpenseData,
  rejectionData,
  type ExpenseInput,
} from '../../src/services/expenseData';
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

// Chave e URL fictícias (nenhuma nota real).
const NFCE_KEY = '3'.repeat(44);
const NFCE_URL = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${NFCE_KEY}|2|1|1|${'A'.repeat(40)}`;

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();
const photoPath = (id: string) => `groups/${GROUP}/receipts/${id}.jpg`;
const nfcePending = { type: 'nfce', nfceKey: NFCE_KEY, nfceUrl: NFCE_URL, nfceStatus: 'pending' };
const nfceOk = {
  type: 'nfce',
  nfceKey: NFCE_KEY,
  nfceUrl: NFCE_URL,
  nfceStatus: 'ok',
  nfceData: { issuerName: 'LOJA TESTE LTDA', totalCents: 20000, date: `${CURRENT}-05` },
};

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

/** Versão já gravada (sem marcadores de horário do servidor), para semear. */
function seeded(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return expense({ createdAt: new Date(), updatedAt: new Date(), ...overrides });
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
    await db.doc(path('a-atual')).set(seeded());
    await db.doc(path('a-fechado')).set(seeded({ date: `${CLOSED}-10`, competence: CLOSED }));
    // Gastos lançados por B, para A revisar.
    await db.doc(path('b-sem')).set(seeded({ createdBy: B, payerUid: B }));
    await db.doc(path('b-foto')).set(
      seeded({ createdBy: B, payerUid: B, receipt: { type: 'photo', photoPath: photoPath('b-foto'), photoUploaded: false } }),
    );
    await db.doc(path('b-foto-ok')).set(
      seeded({ createdBy: B, payerUid: B, receipt: { type: 'photo', photoPath: photoPath('b-foto-ok'), photoUploaded: true } }),
    );
    await db.doc(path('b-fechado')).set(seeded({ createdBy: B, payerUid: B, date: `${CLOSED}-10`, competence: CLOSED }));
    // Gasto de A confirmado pela conferência do QR (gravado pela Function).
    await db.doc(path('a-qr')).set(seeded({ receipt: nfceOk, status: 'confirmed', approval: { byUid: 'nfce', at: new Date() } }));
  });
});

const db = (uid: string) => env.authenticatedContext(uid).firestore();

/** Edição parcial como o app faz: updatedAt do servidor. */
function edit(uid: string, id: string, changes: Record<string, unknown>) {
  return db(uid).doc(path(id)).update({ ...changes, updatedAt: serverTime() });
}

/** Aprovação e recusa exatamente como o app grava (approvalData/rejectionData). */
function approve(uid: string, id: string, byUid = uid) {
  return db(uid).doc(path(id)).update(approvalData(byUid, serverTime()));
}

function reject(uid: string, id: string, reason?: string) {
  return db(uid).doc(path(id)).update(rejectionData(uid, reason, serverTime()));
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
    await assertFails(db(A).doc(path('x')).set(expense({ extra: true })));
    const missing = expense();
    delete missing.personalCents;
    await assertFails(db(A).doc(path('x')).set(missing));
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

describe('comprovante na criação', () => {
  it('foto: caminho do próprio gasto e ainda não enviada', async () => {
    const photo = { type: 'photo', photoPath: photoPath('f1'), photoUploaded: false };
    await assertSucceeds(db(A).doc(path('f1')).set(expense({ receipt: photo })));
  });

  it('foto: recusa caminho de outro gasto e "já enviada" na criação', async () => {
    await assertFails(db(A).doc(path('f2')).set(expense({ receipt: { type: 'photo', photoPath: photoPath('outro'), photoUploaded: false } })));
    await assertFails(db(A).doc(path('f3')).set(expense({ receipt: { type: 'photo', photoPath: photoPath('f3'), photoUploaded: true } })));
  });

  it('QR: só pendente e sem dados da nota', async () => {
    await assertSucceeds(db(A).doc(path('q1')).set(expense({ receipt: nfcePending })));
  });

  it('QR: recusa forjar nfceStatus ok ou os dados da nota', async () => {
    await assertFails(db(A).doc(path('q2')).set(expense({ receipt: nfceOk })));
    await assertFails(db(A).doc(path('q3')).set(expense({ receipt: { ...nfcePending, nfceStatus: 'ok' } })));
    await assertFails(db(A).doc(path('q4')).set(expense({ receipt: { ...nfcePending, nfceData: nfceOk.nfceData } })));
  });

  it('QR: recusa chave mal formada e URL fora da SEFAZ-SP', async () => {
    await assertFails(db(A).doc(path('q5')).set(expense({ receipt: { ...nfcePending, nfceKey: '123' } })));
    await assertFails(db(A).doc(path('q6')).set(expense({ receipt: { ...nfcePending, nfceUrl: 'https://evil.example.com/x' } })));
  });

  it('tipo desconhecido ou campos extras no comprovante são recusados', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ receipt: { type: 'pix' } })));
    await assertFails(db(A).doc(path('x')).set(expense({ receipt: { type: 'none', extra: 1 } })));
  });
});

describe('quem lança nunca confirma', () => {
  it('não cria já confirmado, com nenhum comprovante', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ status: 'confirmed' })));
    await assertFails(
      db(A).doc(path('x')).set(expense({ status: 'confirmed', receipt: { type: 'photo', photoPath: photoPath('x'), photoUploaded: false } })),
    );
    await assertFails(db(A).doc(path('x')).set(expense({ status: 'confirmed', receipt: nfcePending })));
  });

  it('não cria com aprovação, nem a da conferência do QR', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ approval: { byUid: A, at: serverTime() } })));
    await assertFails(db(A).doc(path('x')).set(expense({ approval: { byUid: 'nfce', at: serverTime() } })));
  });

  it('não marca confirmed depois de anexar QR', async () => {
    await assertFails(edit(A, 'a-atual', { receipt: nfcePending, status: 'confirmed' }));
    await assertSucceeds(edit(A, 'a-atual', { receipt: nfcePending }));
    await assertFails(edit(A, 'a-atual', { status: 'confirmed' }));
    await assertFails(edit(A, 'a-atual', { status: 'confirmed', approval: { byUid: 'nfce', at: serverTime() } }));
  });

  it('não aprova o próprio gasto (nem como "nfce")', async () => {
    await assertFails(approve(A, 'a-atual'));
    await assertFails(approve(A, 'a-atual', 'nfce'));
  });

  it('não recusa o próprio gasto', async () => {
    await assertFails(reject(A, 'a-atual'));
  });

  it('editar um gasto confirmado pelo QR volta a pendente e descarta a aprovação', async () => {
    // Igual ao que o app grava: mesmo QR (conferência mantida), aprovação removida.
    await assertSucceeds(
      db(A).doc(path('a-qr')).update({
        description: 'Mercado do mês',
        status: 'pending_approval',
        approval: removeField(),
        updatedAt: serverTime(),
      }),
    );
  });

  it('editar um confirmado sem voltar a pendente é recusado', async () => {
    await assertFails(edit(A, 'a-qr', { description: 'Outro nome' }));
    await assertFails(edit(A, 'a-qr', { description: 'Outro nome', status: 'pending_approval' }));
  });

  it('não forja a conferência do QR numa edição', async () => {
    await assertFails(edit(A, 'a-atual', { receipt: nfceOk }));
    await assertFails(edit(A, 'a-atual', { receipt: { ...nfcePending, nfceStatus: 'failed' } }));
  });
});

describe('aprovação e recusa pelo outro membro', () => {
  it('aprova gasto sem comprovante', async () => {
    await assertSucceeds(approve(A, 'b-sem'));
  });

  it('aprovar com foto ainda não enviada é recusado', async () => {
    await assertFails(approve(A, 'b-foto'));
    await assertSucceeds(approve(A, 'b-foto-ok'));
  });

  it('aprovação em nome de outro ou como "nfce" é recusada', async () => {
    await assertFails(approve(A, 'b-sem', B));
    await assertFails(approve(A, 'b-sem', 'nfce'));
  });

  it('aprovação sem horário do servidor é recusada', async () => {
    await assertFails(
      db(A).doc(path('b-sem')).update({ status: 'confirmed', approval: { byUid: A, at: new Date() }, updatedAt: serverTime() }),
    );
  });

  it('recusa com e sem motivo', async () => {
    await assertSucceeds(reject(A, 'b-sem', 'Anexe a nota, por favor'));
    await assertSucceeds(reject(A, 'b-foto'));
  });

  it('motivo longo demais é recusado (o app corta em 200)', async () => {
    const long = { status: 'returned', rejection: { byUid: A, at: serverTime(), reason: 'x'.repeat(201) }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-sem')).update(long));
    await assertSucceeds(reject(A, 'b-sem', 'x'.repeat(250)));
  });

  it('quem aprova não altera valores nem o comprovante', async () => {
    const base = { status: 'confirmed', approval: { byUid: A, at: serverTime() }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, totalCents: 1 }));
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, payerSharePct: 0 }));
    await assertFails(db(A).doc(path('b-foto')).update({ ...base, 'receipt.photoUploaded': true }));
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, receipt: nfceOk }));
  });

  it('quem revisa não edita nem exclui o gasto do outro', async () => {
    await assertFails(edit(A, 'b-sem', { description: 'Outro' }));
    await assertFails(db(A).doc(path('b-sem')).delete());
  });

  it('não aprova o que não está pendente', async () => {
    await assertSucceeds(reject(A, 'b-sem'));
    await assertFails(approve(A, 'b-sem')); // devolvido
    await assertSucceeds(approve(A, 'b-foto-ok'));
    await assertFails(reject(A, 'b-foto-ok')); // já confirmado
  });

  it('terceiro não aprova nem recusa', async () => {
    await assertFails(approve(C, 'b-sem'));
    await assertFails(reject(C, 'b-sem'));
  });

  it('nada muda em mês fechado', async () => {
    await assertFails(approve(A, 'b-fechado'));
    await assertFails(reject(A, 'b-fechado'));
  });
});

describe('devolvido e correção', () => {
  it('quem lançou corrige o devolvido: volta a pendente e a recusa sai', async () => {
    await assertSucceeds(reject(B, 'a-atual', 'Valor errado'));
    await assertSucceeds(
      db(A).doc(path('a-atual')).update({
        totalCents: 19000,
        status: 'pending_approval',
        rejection: removeField(),
        updatedAt: serverTime(),
      }),
    );
  });

  it('não corrige mantendo a recusa nem pula para confirmado', async () => {
    await assertSucceeds(reject(B, 'a-atual'));
    await assertFails(edit(A, 'a-atual', { totalCents: 19000, status: 'pending_approval' }));
    await assertFails(edit(A, 'a-atual', { status: 'confirmed', rejection: removeField() }));
  });

  it('a fila de fotos marca photoUploaded mesmo com o gasto devolvido, sem mexer em mais nada', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-foto')).set(
        seeded({
          receipt: { type: 'photo', photoPath: photoPath('a-foto'), photoUploaded: false },
          status: 'returned',
          rejection: { byUid: B, at: new Date() },
        }),
      );
    });
    await assertSucceeds(edit(A, 'a-foto', { 'receipt.photoUploaded': true }));
    await assertFails(edit(A, 'a-foto', { 'receipt.photoUploaded': false }));
    await assertFails(edit(A, 'a-foto', { 'receipt.photoUploaded': true, status: 'confirmed' }));
    await assertFails(edit(B, 'a-foto', { 'receipt.photoUploaded': true }));
  });
});

describe('edição', () => {
  it('quem lançou edita', async () => {
    await assertSucceeds(edit(A, 'a-atual', { totalCents: 25000, description: 'Mercado do mês' }));
  });

  it('não troca o autor nem a data de criação', async () => {
    await assertFails(edit(A, 'a-atual', { createdBy: B }));
    await assertFails(edit(A, 'a-atual', { createdAt: new Date() }));
  });

  it('edição continua validando valores', async () => {
    await assertFails(edit(A, 'a-atual', { personalCents: 30000 }));
    await assertFails(edit(A, 'a-atual', { payerUid: C }));
    await assertFails(edit(A, 'a-atual', { extra: true }));
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
  const ids = (expenseId: string) => ({ groupId: GROUP, expenseId });

  it('gasto novo do app passa nas regras, com cada comprovante', async () => {
    await assertSucceeds(db(A).doc(path('app-1')).set(newExpenseData(input, A, CURRENT, ids('app-1'), serverTime())));
    const photo = { ...input, receipt: { type: 'photo' as const, replaced: true } };
    await assertSucceeds(db(A).doc(path('app-2')).set(newExpenseData(photo, A, CURRENT, ids('app-2'), serverTime())));
    const qr = { ...input, receipt: { type: 'nfce' as const, nfceKey: NFCE_KEY, nfceUrl: NFCE_URL } };
    await assertSucceeds(db(A).doc(path('app-3')).set(newExpenseData(qr, A, CURRENT, ids('app-3'), serverTime())));
  });

  it('edição do app passa nas regras, inclusive devolvido corrigido e confirmado pelo QR', async () => {
    const changed = { ...input, totalCents: 9000 };
    const update = () => expenseUpdateData(changed, CURRENT, ids('a-atual'), { type: 'none' }, serverTime(), removeField());
    await assertSucceeds(db(A).doc(path('a-atual')).update(update()));
    await assertSucceeds(reject(B, 'a-atual'));
    await assertSucceeds(db(A).doc(path('a-atual')).update(update()));

    const keepQr = { ...input, totalCents: 20000, receipt: { type: 'nfce' as const, nfceKey: NFCE_KEY, nfceUrl: NFCE_URL } };
    await assertSucceeds(
      db(A).doc(path('a-qr')).update(expenseUpdateData(keepQr, CURRENT, ids('a-qr'), nfceOk as never, serverTime(), removeField())),
    );
  });
});
