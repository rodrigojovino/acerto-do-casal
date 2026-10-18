import { describe, expect, it } from 'vitest';
import type { Expense } from './expenses';
import { authorStatus } from './expenseData';
import { badgeFor, canContest, debtView, originLabel, typeBadges, expenseSubtitle, flagsFor, isAutoConfirmed, splitLabel, tagFor } from './expenseView';

const A = 'uid-a';
const B = 'uid-b';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e1',
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 5000,
    payerUid: A,
    payerSharePct: 50,
    date: '2026-10-05',
    competence: '2026-10',
    receipt: { type: 'none' },
    status: 'pending_approval',
    createdBy: A,
    createdAt: null,
    updatedAt: null,
    pendingWrite: false,
    ...overrides,
  };
}

describe('tagFor', () => {
  it('pendente é "Pendente" para quem lançou e "Aprovar" para o outro', () => {
    expect(tagFor(expense({}), A)).toBe('pending');
    expect(tagFor(expense({}), B)).toBe('approve');
  });

  it('devolvido e confirmado', () => {
    expect(tagFor(expense({ status: 'returned' }), A)).toBe('returned');
    expect(tagFor(expense({ status: 'confirmed' }), A)).toBeNull();
  });
});

describe('splitLabel usa a conversão de split.ts', () => {
  it('cada membro vê a divisão do seu lado', () => {
    const e = expense({ payerUid: B, payerSharePct: 70 });
    expect(splitLabel(e, B)).toBe('70/30');
    expect(splitLabel(e, A)).toBe('30/70');
  });
});

describe('expenseSubtitle', () => {
  it('monta a linha da lista', () => {
    expect(expenseSubtitle(expense({}), A, 'Você')).toBe('Você · 05/10 · R$ 50,00 pessoal · 50/50');
  });

  it('omite a parte pessoal zerada e mostra o ano quando a competência é outra', () => {
    const e = expense({ personalCents: 0, date: '2026-09-28', competence: '2026-10' });
    expect(expenseSubtitle(e, A, 'Você')).toBe('Você · 28/09/2026 · 50/50');
  });
});

describe('debtView', () => {
  const nameOf = (uid: string) => (uid === A ? 'Ana' : 'Bia');

  it('mostra a dívida do lado de cada um', () => {
    const e = { totalCents: 20000, personalCents: 5000, payerUid: A, payerSharePct: 50 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Bia te deve por este gasto', amountCents: 7500 });
    expect(debtView(e, [A, B], B, nameOf)).toEqual({ label: 'Você deve por este gasto', amountCents: 7500 });
  });

  it('respeita divisão diferente de 50/50 e pagador outro', () => {
    // B pagou 100,00 e fica com 70%: A deve 30,00.
    const e = { totalCents: 10000, personalCents: 0, payerUid: B, payerSharePct: 70 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Você deve por este gasto', amountCents: 3000 });
  });

  it('gasto todo pessoal não gera dívida', () => {
    const e = { totalCents: 5000, personalCents: 5000, payerUid: A, payerSharePct: 50 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Ninguém deve nada por este gasto', amountCents: 0 });
  });
});

describe('flagsFor', () => {
  const nfce = (status: 'pending' | 'ok' | 'failed', notaCents?: number) => ({
    type: 'nfce' as const,
    nfceKey: '3'.repeat(44),
    nfceUrl: 'https://www.nfce.fazenda.sp.gov.br/x',
    nfceStatus: status,
    ...(notaCents === undefined ? {} : { nfceData: { issuerName: 'LOJA', totalCents: notaCents, date: '2026-10-05' } }),
  });

  it('valor diferente da nota só quando a nota foi conferida e o valor diverge', () => {
    expect(flagsFor(expense({ totalCents: 20000, receipt: nfce('ok', 19900) }))).toEqual(['nfce-diff']);
    expect(flagsFor(expense({ totalCents: 20000, receipt: nfce('ok', 20000) }))).toEqual([]);
  });

  it('nota em conferência, nota não conferida e foto não enviada', () => {
    expect(flagsFor(expense({ receipt: nfce('pending') }))).toEqual(['nfce-checking']);
    expect(flagsFor(expense({ receipt: nfce('failed') }))).toEqual(['nfce-failed']);
    expect(flagsFor(expense({ receipt: { type: 'photo', photoPath: 'p', photoUploaded: false } }))).toEqual(['photo-missing']);
    expect(flagsFor(expense({ receipt: { type: 'photo', photoPath: 'p', photoUploaded: true } }))).toEqual([]);
    expect(flagsFor(expense({}))).toEqual([]);
  });
});

describe('isAutoConfirmed e canContest', () => {
  it('confirmado sem aprovação (comprovante) ou pela conferência antiga é automático e contestável pelo outro', () => {
    const porComprovante = expense({ status: 'confirmed' });
    const porNfce = expense({ status: 'confirmed', approval: { byUid: 'nfce', at: null } });
    expect(isAutoConfirmed(porComprovante)).toBe(true);
    expect(isAutoConfirmed(porNfce)).toBe(true);
    expect(canContest(porComprovante, B)).toBe(true);
    expect(canContest(porNfce, B)).toBe(true);
  });

  it('aprovado manualmente, pendente ou o próprio gasto não são contestáveis', () => {
    expect(canContest(expense({ status: 'confirmed', approval: { byUid: B, at: null } }), B)).toBe(false);
    expect(canContest(expense({ status: 'pending_approval' }), B)).toBe(false);
    expect(canContest(expense({ status: 'confirmed' }), A)).toBe(false);
  });
});

describe('authorStatus (status que quem lança grava)', () => {
  const none = { type: 'none' as const };
  const photo = { type: 'photo' as const, replaced: true };

  it('criação: sem comprovante pendente, com comprovante confirmado', () => {
    expect(authorStatus(none)).toBe('pending_approval');
    expect(authorStatus(photo)).toBe('confirmed');
  });

  it('editar um confirmado (automático ou aprovado) ou um devolvido vai para aprovação', () => {
    expect(authorStatus(photo, 'confirmed')).toBe('pending_approval');
    expect(authorStatus(none, 'confirmed')).toBe('pending_approval');
    expect(authorStatus(photo, 'returned')).toBe('pending_approval');
  });

  it('pendente continua pendente; com comprovante anexado, confirma', () => {
    expect(authorStatus(none, 'pending_approval')).toBe('pending_approval');
    expect(authorStatus(photo, 'pending_approval')).toBe('confirmed');
  });
});

describe('badgeFor', () => {
  it('pendente: "Pendente" para quem lançou, "Aprovar" para o outro', () => {
    expect(badgeFor(expense({ status: 'pending_approval' }), A)).toEqual({ kind: 'pending', label: 'Pendente' });
    expect(badgeFor(expense({ status: 'pending_approval' }), B)).toEqual({ kind: 'pending', label: 'Aprovar' });
  });

  it('automático (sem aprovação ou "nfce") e validado (aprovação de pessoa)', () => {
    const nfce = { type: 'nfce' as const, nfceKey: '3'.repeat(44), nfceStatus: 'unchecked' as const };
    expect(badgeFor(expense({ status: 'confirmed', receipt: nfce }), B)).toEqual({ kind: 'auto', label: 'Automático' });
    expect(badgeFor(expense({ status: 'confirmed', approval: { byUid: 'nfce', at: null } }), B).kind).toBe('auto');
    expect(badgeFor(expense({ status: 'confirmed', approval: { byUid: B, at: null } }), A)).toEqual({ kind: 'validated', label: 'Validado' });
  });

  it('automático só para QR (qualquer estado); foto = "Foto do recibo"; fixo gerado = "Recorrente aprovado"', () => {
    const photo = { type: 'photo' as const, photoPath: 'p', photoUploaded: true };
    const nfce = { type: 'nfce' as const, nfceKey: '3'.repeat(44), nfceStatus: 'ok' as const };
    expect(badgeFor(expense({ status: 'confirmed', receipt: photo }), B)).toEqual({ kind: 'photo', label: 'Foto do recibo' });
    expect(badgeFor(expense({ status: 'confirmed', receipt: nfce }), B)).toEqual({ kind: 'auto', label: 'Automático' });
    expect(badgeFor({ ...expense({ status: 'confirmed' }), recurringId: 'r1' }, B)).toEqual({
      kind: 'recurring',
      label: 'Recorrente aprovado',
    });
    // Validado por pessoa prevalece sobre a origem.
    expect(badgeFor(expense({ status: 'confirmed', receipt: photo, approval: { byUid: B, at: null } }), A).kind).toBe('validated');
    expect(badgeFor({ ...expense({ status: 'confirmed', approval: { byUid: B, at: null } }), recurringId: 'r1' }, A).kind).toBe(
      'validated',
    );
  });

  it('devolvido: na lista "Devolvido"; no Detalhe, "Contestado" ou "Recusado"', () => {
    const contestado = expense({ status: 'returned', rejection: { byUid: B, at: null, kind: 'contest', reason: 'x' } });
    const recusado = expense({ status: 'returned', rejection: { byUid: B, at: null, kind: 'reject' } });
    expect(badgeFor(contestado, A)).toEqual({ kind: 'returned', label: 'Devolvido' });
    expect(badgeFor(contestado, A, true).label).toBe('Contestado');
    expect(badgeFor(recusado, A, true).label).toBe('Recusado');
  });

  it('a confirmar (recorrente variável)', () => {
    expect(badgeFor(expense({ status: 'awaiting_confirmation' }), A)).toEqual({ kind: 'awaiting', label: 'A confirmar' });
  });
});

describe('originLabel', () => {
  const nameOf = (uid: string) => (uid === A ? 'você' : 'Bia');

  it('validado por quem aprovou', () => {
    expect(originLabel(expense({ status: 'confirmed', approval: { byUid: B, at: null } }), nameOf)).toBe('Validado por Bia');
  });

  it('automático: nota conferida, foto ou recorrente', () => {
    const nfceOk = { type: 'nfce' as const, nfceKey: '3'.repeat(44), nfceStatus: 'ok' as const };
    expect(originLabel(expense({ status: 'confirmed', receipt: nfceOk }), nameOf)).toBe('Automático · nota conferida');
    expect(originLabel(expense({ status: 'confirmed', approval: { byUid: 'nfce', at: null } }), nameOf)).toBe('Automático · nota conferida');
    expect(
      originLabel(expense({ status: 'confirmed', receipt: { type: 'photo', photoPath: 'p', photoUploaded: true } }), nameOf),
    ).toBe('Confirmado pela foto do recibo');
    expect(originLabel({ ...expense({ status: 'confirmed' }), recurringId: 'r1' }, nameOf)).toBe('Gerado do recorrente fixo aprovado');
  });

  it('sem origem quando não está confirmado', () => {
    expect(originLabel(expense({ status: 'pending_approval' }), nameOf)).toBeNull();
  });
});

describe('typeBadges', () => {
  it('parcela e recorrente aparecem ao lado do status', () => {
    expect(typeBadges({ ...expense({ status: 'confirmed' }), installment: { index: 3, count: 10 } })).toEqual(['Parcela 3/10']);
    expect(typeBadges({ ...expense({ status: 'awaiting_confirmation' }), recurringId: 'r1' })).toEqual(['Recorrente']);
    expect(typeBadges(expense({ status: 'confirmed' }))).toEqual([]);
  });

  it('sem "Recorrente" ao lado de "Recorrente aprovado" (redundante)', () => {
    expect(typeBadges({ ...expense({ status: 'confirmed' }), recurringId: 'r1' })).toEqual([]);
    // Fixo editado (pendente) ou validado continua identificado como recorrente.
    expect(typeBadges({ ...expense({ status: 'pending_approval' }), recurringId: 'r1' })).toEqual(['Recorrente']);
    expect(typeBadges({ ...expense({ status: 'confirmed', approval: { byUid: B, at: null } }), recurringId: 'r1' })).toEqual([
      'Recorrente',
    ]);
  });
});
