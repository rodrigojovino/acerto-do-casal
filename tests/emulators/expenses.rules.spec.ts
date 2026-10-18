import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approvalData,
  contestData,
  validationData,
  expenseUpdateData,
  newExpenseData,
  rejectionData,
  type ExpenseInput,
} from '../../src/services/expenseData';
import { SEFAZ_SP_CANONICAL, checkDigit, parseFiscalCode, parseTypedKey } from '../../functions/src/nfce';
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

// Chaves e URL fictícias (nenhuma nota real): NFC-e (modelo 65) de SP e de MG.
const keyFor = (ufCode: string) => {
  const base = `${ufCode}26101122233300018165001000000123112345678`;
  return base + checkDigit(base);
};
const NFCE_KEY = keyFor('35');
const NFCE_KEY_MG = keyFor('31');
// URL de consulta montada da chave (formato do QR versão 3), igual para QR, código de barras e digitada.
const NFCE_URL = `${SEFAZ_SP_CANONICAL}${NFCE_KEY}|3|1`;
const nfceUnchecked = { type: 'nfce', nfceKey: NFCE_KEY_MG, entry: 'read', nfceStatus: 'unchecked' };

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const removeField = () => firebase.firestore.FieldValue.delete();
const photoPath = (id: string) => `groups/${GROUP}/receipts/${id}.jpg`;
const nfcePending = { type: 'nfce', nfceKey: NFCE_KEY, entry: 'read', nfceUrl: NFCE_URL, nfceStatus: 'pending' };
const nfceOk = {
  type: 'nfce',
  nfceKey: NFCE_KEY,
  entry: 'read',
  nfceUrl: NFCE_URL,
  nfceStatus: 'ok',
  nfceData: { issuerName: 'LOJA TESTE LTDA', totalCents: 20000, date: `${CURRENT}-05` },
};

/** Status pelo comprovante, como o app grava, salvo quando o teste define outro. */
function expense(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 5000,
    payerUid: A,
    payerSharePct: 50,
    date: `${CURRENT}-05`,
    competence: CURRENT,
    receipt: { type: 'none' },
    createdBy: A,
    createdAt: serverTime(),
    updatedAt: serverTime(),
    ...overrides,
  };
  if (!('status' in overrides)) {
    data.status = (data.receipt as { type: string }).type === 'none' ? 'pending_approval' : 'confirmed';
  }
  return data;
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
    const photo = (id: string, uploaded: boolean) => ({ type: 'photo', photoPath: photoPath(id), photoUploaded: uploaded });
    await db.doc(path('b-sem')).set(seeded({ createdBy: B, payerUid: B })); // pendente
    // Confirmado pelo comprovante (regra atual), com a foto ainda não enviada: contestável.
    await db.doc(path('b-foto')).set(seeded({ createdBy: B, payerUid: B, receipt: photo('b-foto', false) }));
    // Dados da versão anterior: pendente com foto não enviada (aprovado manualmente).
    await db.doc(path('b-foto-antigo')).set(
      seeded({ createdBy: B, payerUid: B, receipt: photo('b-foto-antigo', false), status: 'pending_approval' }),
    );
    // Confirmado pela conferência do QR da versão anterior: contestável.
    await db.doc(path('b-qr-antigo')).set(
      seeded({ createdBy: B, payerUid: B, receipt: nfceOk, status: 'confirmed', approval: { byUid: 'nfce', at: new Date() } }),
    );
    // Aprovado manualmente por A: não contestável.
    await db.doc(path('b-aprovado')).set(
      seeded({ createdBy: B, payerUid: B, status: 'confirmed', approval: { byUid: A, at: new Date() } }),
    );
    await db.doc(path('b-fechado')).set(seeded({ createdBy: B, payerUid: B, date: `${CLOSED}-10`, competence: CLOSED }));
    await db.doc(path('b-fechado-foto')).set(
      seeded({ createdBy: B, payerUid: B, receipt: photo('b-fechado-foto', true), date: `${CLOSED}-10`, competence: CLOSED }),
    );
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

function validate(uid: string, id: string, byUid = uid) {
  return db(uid).doc(path(id)).update(validationData(byUid, serverTime()));
}

function contest(uid: string, id: string, reason = 'O valor não bate com a nota') {
  return db(uid).doc(path(id)).update(contestData(uid, reason, serverTime(), removeField()));
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

  it('QR: só pendente de conferência e sem dados da nota', async () => {
    await assertSucceeds(db(A).doc(path('q1')).set(expense({ receipt: nfcePending })));
  });

  it('QR: recusa forjar nfceStatus ok ou os dados da nota', async () => {
    await assertFails(db(A).doc(path('q2')).set(expense({ receipt: nfceOk })));
    await assertFails(db(A).doc(path('q3')).set(expense({ receipt: { ...nfcePending, nfceStatus: 'ok' } })));
    await assertFails(db(A).doc(path('q4')).set(expense({ receipt: { ...nfcePending, nfceData: nfceOk.nfceData } })));
  });

  it('QR: recusa chave mal formada, NF-e pedindo consulta e URL fora da montada da chave', async () => {
    await assertFails(db(A).doc(path('q5')).set(expense({ receipt: { ...nfcePending, nfceKey: '123' } })));
    const nfe = NFCE_KEY.slice(0, 20) + '55' + NFCE_KEY.slice(22);
    await assertFails(
      db(A).doc(path('q5b')).set(expense({ receipt: { ...nfcePending, nfceKey: nfe, nfceUrl: SEFAZ_SP_CANONICAL + nfe } })),
    );
    await assertFails(db(A).doc(path('q6')).set(expense({ receipt: { ...nfcePending, nfceUrl: 'https://evil.example.com/x' } })));
    await assertFails(
      db(A).doc(path('q7')).set(
        expense({ receipt: { ...nfcePending, nfceUrl: `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${NFCE_KEY}|2|1` } }),
      ),
    );
    // Com o hash do QR versão 2: o comprovante guarda só a URL montada da chave.
    await assertFails(
      db(A).doc(path('q7b')).set(
        expense({ receipt: { ...nfcePending, nfceUrl: `${SEFAZ_SP_CANONICAL}${NFCE_KEY}|2|1|1|${'A'.repeat(40)}` } }),
      ),
    );
  });

  it('NF-e (modelo 55) de qualquer estado vale como "unchecked", lida ou digitada, sem consulta', async () => {
    const model = (key: string, m: string) => key.slice(0, 20) + m + key.slice(22);
    const nfe = (key: string, entry: string) => ({ type: 'nfce', nfceKey: key, entry, nfceStatus: 'unchecked' });
    await assertSucceeds(db(A).doc(path('nfe1')).set(expense({ receipt: nfe(model(NFCE_KEY, '55'), 'read') })));
    await assertSucceeds(db(A).doc(path('nfe2')).set(expense({ receipt: nfe(model(NFCE_KEY, '55'), 'typed') })));
    await assertSucceeds(db(A).doc(path('nfe3')).set(expense({ receipt: nfe(model(NFCE_KEY_MG, '55'), 'read') })));
    // Outro modelo (ex.: 57, CT-e) não é comprovante.
    await assertFails(db(A).doc(path('cte')).set(expense({ receipt: nfe(model(NFCE_KEY, '57'), 'read') })));
  });

  it('origem da chave obrigatória: lida ou digitada', async () => {
    const withoutEntry: Record<string, unknown> = { ...nfcePending };
    delete withoutEntry.entry;
    await assertFails(db(A).doc(path('e1')).set(expense({ receipt: withoutEntry })));
    await assertFails(db(A).doc(path('e2')).set(expense({ receipt: { ...nfcePending, entry: 'colada' } })));
    await assertSucceeds(db(A).doc(path('e3')).set(expense({ receipt: { ...nfcePending, entry: 'typed' } })));
  });

  it('QR: a URL de SP precisa ser da própria chave', async () => {
    const other = NFCE_KEY.slice(0, 34) + '9999999999';
    await assertFails(
      db(A).doc(path('q8')).set(expense({ receipt: { ...nfcePending, nfceUrl: `${SEFAZ_SP_CANONICAL}${other}|2|1` } })),
    );
  });

  it('QR de outro estado: vale como "unchecked", sem URL', async () => {
    await assertSucceeds(db(A).doc(path('mg1')).set(expense({ receipt: nfceUnchecked })));
  });

  it('QR de outro estado não pede conferência; QR de SP não fica "unchecked"', async () => {
    await assertFails(
      db(A).doc(path('mg3')).set(
        expense({ receipt: { ...nfceUnchecked, nfceStatus: 'pending', nfceUrl: SEFAZ_SP_CANONICAL + NFCE_KEY_MG } }),
      ),
    );
    await assertFails(db(A).doc(path('mg4')).set(expense({ receipt: { ...nfceUnchecked, nfceUrl: SEFAZ_SP_CANONICAL + NFCE_KEY_MG } })));
    await assertFails(
      db(A).doc(path('sp-unchecked')).set(
        expense({ receipt: { type: 'nfce', nfceKey: NFCE_KEY, entry: 'read', nfceStatus: 'unchecked' } }),
      ),
    );
  });

  it('tipo desconhecido ou campos extras no comprovante são recusados', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ receipt: { type: 'pix' } })));
    await assertFails(db(A).doc(path('x')).set(expense({ receipt: { type: 'none', extra: 1 } })));
  });
});

describe('status pelo comprovante (quem lança)', () => {
  it('sem comprovante nasce pendente; não pode nascer confirmado', async () => {
    await assertSucceeds(db(A).doc(path('s1')).set(expense()));
    await assertFails(db(A).doc(path('s2')).set(expense({ status: 'confirmed' })));
  });

  it('com foto ou QR (SP ou outro estado) nasce confirmado; não pode nascer pendente', async () => {
    const photo = (id: string) => ({ type: 'photo', photoPath: photoPath(id), photoUploaded: false });
    await assertSucceeds(db(A).doc(path('c1')).set(expense({ receipt: photo('c1') })));
    await assertSucceeds(db(A).doc(path('c2')).set(expense({ receipt: nfcePending })));
    await assertSucceeds(db(A).doc(path('c3')).set(expense({ receipt: nfceUnchecked })));
    await assertFails(db(A).doc(path('c4')).set(expense({ receipt: photo('c4'), status: 'pending_approval' })));
  });

  it('não cria com aprovação, nem a da conferência do QR', async () => {
    await assertFails(db(A).doc(path('x')).set(expense({ approval: { byUid: A, at: serverTime() } })));
    await assertFails(db(A).doc(path('x')).set(expense({ approval: { byUid: 'nfce', at: serverTime() } })));
  });

  it('anexar comprovante a um pendente o confirma; sem trocar o status é recusado', async () => {
    await assertFails(edit(A, 'a-atual', { receipt: nfcePending }));
    await assertSucceeds(edit(A, 'a-atual', { receipt: nfcePending, status: 'confirmed' }));
  });

  it('pendente sem comprovante não vira confirmado pela mão de quem lança', async () => {
    await assertFails(edit(A, 'a-atual', { status: 'confirmed' }));
    await assertFails(edit(A, 'a-atual', { status: 'confirmed', approval: { byUid: 'nfce', at: serverTime() } }));
  });

  it('tirar o comprovante de um confirmado o devolve a pendente', async () => {
    await assertSucceeds(edit(A, 'a-qr', { receipt: { type: 'none' }, status: 'pending_approval', approval: removeField() }));
  });

  it('editar um confirmado pelo comprovante vai para aprovação, mesmo mantendo o comprovante', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-foto-ok')).set(
        seeded({ receipt: { type: 'photo', photoPath: photoPath('a-foto-ok'), photoUploaded: true } }),
      );
    });
    await assertFails(edit(A, 'a-foto-ok', { description: 'Mercado do mês' })); // continuaria confirmado
    await assertSucceeds(edit(A, 'a-foto-ok', { description: 'Mercado do mês', status: 'pending_approval' }));
  });

  it('editar um confirmado pela conferência antiga do QR vai para aprovação e tira a aprovação "nfce"', async () => {
    await assertFails(edit(A, 'a-qr', { description: 'Mercado do mês', approval: removeField() }));
    await assertSucceeds(edit(A, 'a-qr', { description: 'Mercado do mês', status: 'pending_approval', approval: removeField() }));
  });

  it('editar um gasto aprovado manualmente vai para aprovação e tira a aprovação', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-aprovado')).set(seeded({ status: 'confirmed', approval: { byUid: B, at: new Date() } }));
    });
    await assertFails(edit(A, 'a-aprovado', { description: 'Outro nome' })); // mantém a aprovação
    await assertFails(edit(A, 'a-aprovado', { description: 'Outro nome', approval: removeField() })); // continuaria confirmado
    await assertSucceeds(edit(A, 'a-aprovado', { description: 'Outro nome', status: 'pending_approval', approval: removeField() }));
  });

  it('anexar comprovante a um aprovado não o mantém confirmado', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-aprovado')).set(seeded({ status: 'confirmed', approval: { byUid: B, at: new Date() } }));
    });
    await assertFails(edit(A, 'a-aprovado', { receipt: nfcePending, approval: removeField() }));
    await assertSucceeds(edit(A, 'a-aprovado', { receipt: nfcePending, status: 'pending_approval', approval: removeField() }));
  });

  it('editar um pendente sem comprovante o mantém pendente', async () => {
    await assertSucceeds(edit(A, 'a-atual', { description: 'Mercado do mês' }));
    await assertFails(edit(A, 'a-atual', { description: 'Mercado', status: 'confirmed' }));
  });

  it('não aprova, recusa nem contesta o próprio gasto', async () => {
    await assertFails(approve(A, 'a-atual'));
    await assertFails(approve(A, 'a-atual', 'nfce'));
    await assertFails(reject(A, 'a-atual'));
    await assertFails(contest(A, 'a-qr'));
  });

  it('não forja a conferência do QR numa edição', async () => {
    await assertFails(edit(A, 'a-atual', { receipt: nfceOk, status: 'confirmed' }));
    await assertFails(edit(A, 'a-atual', { receipt: { ...nfcePending, nfceStatus: 'failed' }, status: 'confirmed' }));
  });
});

describe('aprovação e recusa de pendente pelo outro membro', () => {
  it('aprova gasto sem comprovante', async () => {
    await assertSucceeds(approve(A, 'b-sem'));
  });

  it('pendente antigo com foto ainda não enviada pode ser aprovado (sem bloqueio)', async () => {
    await assertSucceeds(approve(A, 'b-foto-antigo'));
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
    await assertSucceeds(reject(A, 'b-foto-antigo'));
  });

  it('recusa sem o tipo, ou com motivo longo demais, é recusada (o app corta em 200)', async () => {
    const noKind = { status: 'returned', rejection: { byUid: A, at: serverTime() }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-sem')).update(noKind));
    const long = { status: 'returned', rejection: { byUid: A, at: serverTime(), kind: 'reject', reason: 'x'.repeat(201) }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-sem')).update(long));
    await assertSucceeds(reject(A, 'b-sem', 'x'.repeat(250)));
  });

  it('quem aprova não altera valores nem o comprovante', async () => {
    const base = { status: 'confirmed', approval: { byUid: A, at: serverTime() }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, totalCents: 1 }));
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, payerSharePct: 0 }));
    await assertFails(db(A).doc(path('b-foto-antigo')).update({ ...base, 'receipt.photoUploaded': true }));
    await assertFails(db(A).doc(path('b-sem')).update({ ...base, receipt: nfceOk }));
  });

  it('quem revisa não edita nem exclui o gasto do outro', async () => {
    await assertFails(edit(A, 'b-sem', { description: 'Outro' }));
    await assertFails(db(A).doc(path('b-sem')).delete());
  });

  it('não aprova nem recusa o que não está pendente', async () => {
    await assertFails(approve(A, 'b-aprovado')); // já aprovado
    await assertFails(reject(A, 'b-foto')); // confirmado se contesta, não se recusa
    await assertSucceeds(reject(A, 'b-sem'));
    await assertFails(approve(A, 'b-sem')); // devolvido
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

describe('contestação de confirmado automaticamente', () => {
  it('o outro membro contesta um confirmado pelo comprovante, mesmo com a foto não enviada', async () => {
    await assertSucceeds(contest(A, 'b-foto'));
  });

  it('contesta o confirmado pela conferência antiga do QR (tira a aprovação "nfce")', async () => {
    await assertSucceeds(contest(A, 'b-qr-antigo'));
  });

  it('contestar exige motivo', async () => {
    const semMotivo = { status: 'returned', rejection: { byUid: A, at: serverTime(), kind: 'contest' }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-foto')).update(semMotivo));
    const vazio = { status: 'returned', rejection: { byUid: A, at: serverTime(), kind: 'contest', reason: '   ' }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-foto')).update(vazio));
  });

  it('gasto aprovado manualmente não é contestável', async () => {
    await assertFails(contest(A, 'b-aprovado'));
  });

  it('pendente não se contesta (se recusa)', async () => {
    await assertFails(contest(A, 'b-sem'));
  });

  it('contestação mantendo a aprovação "nfce" é recusada', async () => {
    const keep = { status: 'returned', rejection: { byUid: A, at: serverTime(), kind: 'contest', reason: 'x' }, updatedAt: serverTime() };
    await assertFails(db(A).doc(path('b-qr-antigo')).update(keep));
  });

  it('terceiro não contesta; nada se contesta em mês fechado', async () => {
    await assertFails(contest(C, 'b-foto'));
    await assertFails(contest(A, 'b-fechado-foto'));
  });

  it('o contestado vai para quem lançou corrigir (vai para aprovação) ou excluir', async () => {
    await assertSucceeds(contest(A, 'b-foto'));
    // Mesmo com o comprovante, a correção de um contestado não volta confirmada.
    await assertFails(edit(B, 'b-foto', { totalCents: 19000, status: 'confirmed', rejection: removeField() }));
    await assertSucceeds(edit(B, 'b-foto', { totalCents: 19000, status: 'pending_approval', rejection: removeField() }));
    await assertSucceeds(approve(A, 'b-foto'));
    // Agora aprovado manualmente: não é mais contestável.
    await assertFails(contest(A, 'b-foto'));
  });

  it('quem lançou exclui o contestado', async () => {
    await assertSucceeds(contest(A, 'b-foto'));
    await assertSucceeds(db(B).doc(path('b-foto')).delete());
  });
});

describe('validação de confirmado automaticamente', () => {
  it('o outro membro valida um confirmado pelo comprovante, sem mudar o status', async () => {
    await assertSucceeds(validate(A, 'b-foto'));
  });

  it('valida o confirmado pela conferência antiga do QR (troca a aprovação "nfce")', async () => {
    await assertSucceeds(validate(A, 'b-qr-antigo'));
  });

  it('não valida o próprio gasto', async () => {
    await assertFails(validate(A, 'a-qr'));
  });

  it('não valida um pendente (pendente se aprova)', async () => {
    // Validar = gravar a aprovação mantendo confirmed; num pendente isso é aprovar.
    await assertFails(db(A).doc(path('b-sem')).update({ approval: { byUid: A, at: serverTime() }, updatedAt: serverTime() }));
  });

  it('não valida em mês fechado; terceiro não valida', async () => {
    await assertFails(validate(A, 'b-fechado-foto'));
    await assertFails(validate(C, 'b-foto'));
  });

  it('não valida em nome do outro, como "nfce" ou sem horário do servidor', async () => {
    await assertFails(validate(A, 'b-foto', B));
    await assertFails(validate(A, 'b-foto', 'nfce'));
    await assertFails(
      db(A).doc(path('b-foto')).update({ status: 'confirmed', approval: { byUid: A, at: new Date() }, updatedAt: serverTime() }),
    );
  });

  it('validar não altera valores nem o status', async () => {
    await assertFails(db(A).doc(path('b-foto')).update({ ...validationData(A, serverTime()), totalCents: 1 }));
    await assertFails(db(A).doc(path('b-foto')).update({ ...validationData(A, serverTime()), status: 'pending_approval' }));
  });

  it('validado conta como aprovado: não é mais contestável nem validável, e editado volta para aprovação', async () => {
    await assertSucceeds(validate(A, 'b-foto'));
    await assertFails(contest(A, 'b-foto'));
    await assertFails(validate(A, 'b-foto'));
    await assertFails(edit(B, 'b-foto', { description: 'Outro', approval: removeField() })); // continuaria confirmado
    await assertSucceeds(edit(B, 'b-foto', { description: 'Outro', status: 'pending_approval', approval: removeField() }));
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

  it('não corrige mantendo a recusa nem pula para confirmado, mesmo anexando comprovante', async () => {
    await assertSucceeds(reject(B, 'a-atual'));
    await assertFails(edit(A, 'a-atual', { totalCents: 19000, status: 'pending_approval' }));
    await assertFails(edit(A, 'a-atual', { status: 'confirmed', rejection: removeField() }));
    await assertFails(edit(A, 'a-atual', { receipt: nfcePending, status: 'confirmed', rejection: removeField() }));
    await assertSucceeds(edit(A, 'a-atual', { receipt: nfcePending, status: 'pending_approval', rejection: removeField() }));
  });

  it('a fila de fotos marca photoUploaded mesmo com o gasto devolvido, sem mexer em mais nada', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-foto')).set(
        seeded({
          receipt: { type: 'photo', photoPath: photoPath('a-foto'), photoUploaded: false },
          status: 'returned',
          rejection: { byUid: B, at: new Date(), kind: 'contest', reason: 'Foto ilegível' },
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
describe('foto da nota junto com a chave', () => {
  const keyPhoto = (id: string, uploaded = false) => ({ ...nfceUnchecked, photoPath: photoPath(id), photoUploaded: uploaded });

  it('criar com chave e foto: continua confirmado automático; caminho errado ou já enviada é recusado', async () => {
    await assertSucceeds(db(A).doc(path('kf1')).set(expense({ receipt: keyPhoto('kf1') })));
    await assertSucceeds(db(A).doc(path('kf2')).set(expense({ receipt: { ...nfcePending, photoPath: photoPath('kf2'), photoUploaded: false } })));
    await assertFails(db(A).doc(path('kf3')).set(expense({ receipt: keyPhoto('outro') })));
    await assertFails(db(A).doc(path('kf4')).set(expense({ receipt: keyPhoto('kf4', true) })));
    await assertFails(db(A).doc(path('kf5')).set(expense({ receipt: { ...nfceUnchecked, photoPath: photoPath('kf5') } })));
  });

  it('anexar a foto depois num confirmado com chave conferida: a conferência fica e volta para aprovação', async () => {
    const input = { description: 'Mercado', totalCents: 20000, personalCents: 5000, payerUid: A, payerSharePct: 50, date: `${CURRENT}-05` };
    const choice = { type: 'nfce' as const, nfceKey: NFCE_KEY, entry: 'read' as const, photo: { replaced: true } };
    const data = expenseUpdateData({ ...input, receipt: choice }, CURRENT, { groupId: GROUP, expenseId: 'a-qr' }, { receipt: nfceOk as never, status: 'confirmed' }, serverTime(), removeField());
    if (data.status !== 'pending_approval') throw new Error('anexar a foto num confirmado é edição: volta para aprovação');
    await assertFails(db(A).doc(path('a-qr')).update({ ...data, status: 'confirmed' }));
    await assertSucceeds(db(A).doc(path('a-qr')).update(data));
  });

  it('a fila marca a foto da nota como enviada (sem mexer no status); sem foto anexada, não', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('kf6')).set(seeded({ receipt: keyPhoto('kf6'), status: 'confirmed' }));
      await ctx.firestore().doc(path('kf7')).set(seeded({ receipt: nfceUnchecked, status: 'confirmed' }));
    });
    await assertSucceeds(edit(A, 'kf6', { 'receipt.photoUploaded': true }));
    await assertFails(edit(A, 'kf7', { 'receipt.photoUploaded': true }));
  });
});

describe('observação', () => {
  it('opcional, até 300 caracteres; vazia ou de outro tipo é recusada', async () => {
    await assertSucceeds(db(A).doc(path('n1')).set(expense({ note: 'churrasco do sábado' })));
    await assertSucceeds(db(A).doc(path('n2')).set(expense({ note: 'x'.repeat(300) })));
    await assertFails(db(A).doc(path('n3')).set(expense({ note: 'x'.repeat(301) })));
    await assertFails(db(A).doc(path('n4')).set(expense({ note: '   ' })));
    await assertFails(db(A).doc(path('n5')).set(expense({ note: 42 })));
  });

  it('o app grava a observação aparada; vazia sai do documento', async () => {
    const input = { description: 'Mercado', totalCents: 20000, personalCents: 0, payerUid: A, payerSharePct: 50, date: `${CURRENT}-05`, receipt: { type: 'none' as const } };
    const withNote = newExpenseData({ ...input, note: '  dividido com a família  ' }, A, CURRENT, { groupId: GROUP, expenseId: 'n6' }, serverTime());
    expect(withNote.note).toBe('dividido com a família');
    await assertSucceeds(db(A).doc(path('n6')).set(withNote));
    const cleared = expenseUpdateData({ ...input, note: '' }, CURRENT, { groupId: GROUP, expenseId: 'n6' }, { receipt: { type: 'none' }, status: 'pending_approval' }, serverTime(), removeField());
    await assertSucceeds(db(A).doc(path('n6')).update(cleared));
  });

  it('mudar a observação de um confirmado volta para aprovação', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('n7')).set(seeded({ status: 'confirmed', approval: { byUid: B, at: new Date() } }));
    });
    await assertFails(edit(A, 'n7', { note: 'esqueci de dizer' }));
    await assertFails(edit(A, 'n7', { note: 'esqueci de dizer', approval: removeField() }));
    await assertSucceeds(edit(A, 'n7', { note: 'esqueci de dizer', status: 'pending_approval', approval: removeField() }));
  });

  it('o outro membro não escreve nem muda a observação', async () => {
    await assertFails(edit(B, 'a-atual', { note: 'não foi bem assim' }));
    await assertFails(
      db(B).doc(path('a-atual')).update({ status: 'confirmed', approval: { byUid: B, at: serverTime() }, note: 'ok', updatedAt: serverTime() }),
    );
  });
});

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
    const qr = { ...input, receipt: { type: 'nfce' as const, nfceKey: NFCE_KEY, entry: 'read' as const } };
    await assertSucceeds(db(A).doc(path('app-3')).set(newExpenseData(qr, A, CURRENT, ids('app-3'), serverTime())));
    const qrMg = { ...input, receipt: { type: 'nfce' as const, nfceKey: NFCE_KEY_MG, entry: 'read' as const } };
    await assertSucceeds(db(A).doc(path('app-4')).set(newExpenseData(qrMg, A, CURRENT, ids('app-4'), serverTime())));
  });

  it('QR e código de barras da mesma nota: mesmo comprovante; digitada de SP também vai para a consulta', async () => {
    const asReceipt = (key: string, entry: 'read' | 'typed') =>
      newExpenseData({ ...input, receipt: { type: 'nfce', nfceKey: key, entry } }, A, CURRENT, ids('x'), serverTime()).receipt;
    const fromQr = parseFiscalCode(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${NFCE_KEY}|2|1|1|${'A'.repeat(40)}`);
    const fromBarcode = parseFiscalCode(NFCE_KEY);
    expect(asReceipt(fromQr.key, 'read')).toEqual(asReceipt(fromBarcode.key, 'read'));

    const typed = parseTypedKey(NFCE_KEY.replace(/(\d{4})(?=\d)/g, '$1 '));
    expect(asReceipt(typed.key, 'typed')).toMatchObject({ nfceStatus: 'pending', nfceUrl: NFCE_URL, entry: 'typed' });
    const typedInput = { ...input, receipt: { type: 'nfce' as const, nfceKey: typed.key, entry: 'typed' as const } };
    await assertSucceeds(db(A).doc(path('app-typed')).set(newExpenseData(typedInput, A, CURRENT, ids('app-typed'), serverTime())));

    // Dígito verificador inválido: recusado ao digitar, antes de gravar (as regras não calculam o módulo 11).
    expect(() => parseTypedKey(NFCE_KEY.slice(0, 43) + ((Number(NFCE_KEY[43]) + 1) % 10))).toThrow(/dígito verificador/);
  });

  it('edição do app passa nas regras: pendente, devolvido corrigido e confirmado pelo QR', async () => {
    const changed = { ...input, totalCents: 9000 };
    const update = (status: 'pending_approval' | 'returned') =>
      expenseUpdateData(changed, CURRENT, ids('a-atual'), { receipt: { type: 'none' }, status }, serverTime(), removeField());
    await assertSucceeds(db(A).doc(path('a-atual')).update(update('pending_approval')));
    await assertSucceeds(reject(B, 'a-atual'));
    await assertSucceeds(db(A).doc(path('a-atual')).update(update('returned')));

    // Confirmado editado (mesmo QR): o app grava pendente, e as regras aceitam.
    const keepQr = { ...input, totalCents: 20000, receipt: { type: 'nfce' as const, nfceKey: NFCE_KEY, entry: 'read' as const } };
    const qrUpdate = expenseUpdateData(keepQr, CURRENT, ids('a-qr'), { receipt: nfceOk as never, status: 'confirmed' }, serverTime(), removeField());
    if (qrUpdate.status !== 'pending_approval') throw new Error('o app manteria confirmado um gasto editado');
    await assertSucceeds(db(A).doc(path('a-qr')).update(qrUpdate));

    // Pendente que recebe comprovante: o app grava confirmado, e as regras aceitam.
    const withPhoto = { ...input, receipt: { type: 'photo' as const, replaced: true } };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(path('a-anexar')).set(seeded());
    });
    const attach = expenseUpdateData(withPhoto, CURRENT, ids('a-anexar'), { receipt: { type: 'none' }, status: 'pending_approval' }, serverTime(), removeField());
    if (attach.status !== 'confirmed') throw new Error('anexar comprovante a um pendente deveria confirmar');
    await assertSucceeds(db(A).doc(path('a-anexar')).update(attach));
  });

  it('contestação do app passa nas regras e exige motivo', async () => {
    await assertSucceeds(db(A).doc(path('b-foto')).update(contestData(A, '  Valor errado  ', serverTime(), removeField())));
    // O próprio builder recusa contestar sem motivo.
    let threw = false;
    try {
      contestData(A, '   ', serverTime(), removeField());
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('contestData aceitou motivo vazio');
  });
});
