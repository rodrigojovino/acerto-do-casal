import { describe, expect, it } from 'vitest';
import {
  actionCount,
  countLabel,
  expenseNotices,
  monthNotices,
  noteSummary,
  receiptOrigin,
  recurringNotices,
  variableRecurringSummary,
  type ExpenseSnapshot,
  type MonthSnapshot,
  type NoticeContext,
  type RecurringSnapshot,
} from './notifications';

// UIDs e nomes fictícios.
const A = 'uid-a';
const B = 'uid-b';
const ctx: NoticeContext = { members: [A, B], nameOf: (uid) => (uid === A ? 'Ana' : 'Bia') };
const brl = (s: string) => s.replace(/\s/g, ' ');

function expense(overrides: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot {
  return { description: 'Mercado', totalCents: 21400, status: 'pending_approval', createdBy: A, receipt: { type: 'none' }, ...overrides };
}

const nfceKey = (model: string) => '3'.repeat(20) + model + '3'.repeat(22);

describe('expenseNotices: lançamento', () => {
  it('pendente: avisa o outro, com "toque para aprovar"', () => {
    const [n] = expenseNotices(null, expense(), 'g1', ctx);
    expect(n).toMatchObject({ toUid: B, category: 'expenses', route: '/gasto/g1' });
    expect(brl(n.body)).toBe('Ana lançou Mercado · R$ 214,00 · toque para aprovar');
  });

  it('confirmado automático: indica a origem para convidar à conferência', () => {
    const photo = expenseNotices(null, expense({ status: 'confirmed', receipt: { type: 'photo' } }), 'g1', ctx)[0];
    expect(brl(photo.body)).toBe('Ana lançou Mercado · R$ 214,00 · foto do recibo');
    const ok = { type: 'nfce', nfceKey: nfceKey('65'), nfceStatus: 'ok' };
    expect(expenseNotices(null, expense({ status: 'confirmed', receipt: ok }), 'g1', ctx)[0].body).toMatch(/· nota conferida$/);
    expect(receiptOrigin({ type: 'nfce', nfceKey: nfceKey('65'), nfceStatus: 'pending' })).toBe('NFC-e em conferência');
    expect(receiptOrigin({ type: 'nfce', nfceKey: nfceKey('55'), nfceStatus: 'unchecked' })).toBe('NF-e');
  });

  it('série de parcelas: um aviso só (parcela 1), com o valor da série', () => {
    const inst = (index: number) => ({ seriesId: 's1', index, count: 10, firstMonth: '2026-10', purchaseCents: 214000 });
    const first = expenseNotices(null, expense({ description: 'Geladeira', installment: inst(1) }), 's1', ctx);
    expect(first).toHaveLength(1);
    expect(brl(first[0].body)).toBe('Ana lançou Geladeira · 10x de R$ 214,00 · toque para aprovar');
    expect(expenseNotices(null, expense({ installment: inst(2) }), 's1-2', ctx)).toEqual([]);
  });

  it('recorrente gerado não avisa; exclusão não avisa', () => {
    expect(expenseNotices(null, expense({ recurringId: 'r1', status: 'confirmed' }), 'rec', ctx)).toEqual([]);
    expect(expenseNotices(expense(), null, 'g1', ctx)).toEqual([]);
  });
});

describe('observação nos avisos de aprovação', () => {
  it('resumo de uma linha, com "…" acima do limite', () => {
    expect(noteSummary('  churrasco\n do  sábado ')).toBe('churrasco do sábado');
    expect(noteSummary('')).toBeNull();
    expect(noteSummary(undefined)).toBeNull();
    const long = noteSummary('a'.repeat(100));
    expect(long).toHaveLength(60);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('aviso para aprovar e de confirmado automático levam o resumo (depois da origem)', () => {
    const pending = expenseNotices(null, expense({ note: 'churrasco do sábado' }), 'g1', ctx)[0];
    expect(brl(pending.body)).toBe('Ana lançou Mercado · R$ 214,00 · toque para aprovar — “churrasco do sábado”');
    const auto = expenseNotices(null, expense({ status: 'confirmed', receipt: { type: 'photo' }, note: 'feira do mês' }), 'g1', ctx)[0];
    expect(brl(auto.body)).toBe('Ana lançou Mercado · R$ 214,00 · foto do recibo — “feira do mês”');
    const noNote = expenseNotices(null, expense({ status: 'confirmed', receipt: { type: 'photo' } }), 'g1', ctx)[0];
    expect(noNote.body.endsWith('foto do recibo')).toBe(true);
  });
});

describe('expenseNotices: devolução, correção e confirmação', () => {
  it('recusado ou contestado: avisa quem lançou, com o motivo', () => {
    const rejected = expense({ status: 'returned', rejection: { byUid: B, kind: 'reject', reason: 'anexe a nota' } });
    const [n] = expenseNotices(expense(), rejected, 'g1', ctx);
    expect(n).toMatchObject({ toUid: A, category: 'returns', body: 'Bia recusou Mercado: “anexe a nota”' });
    const contested = expense({ status: 'returned', rejection: { byUid: B, kind: 'contest', reason: 'valor errado' } });
    expect(expenseNotices(expense({ status: 'confirmed' }), contested, 'g1', ctx)[0].body).toBe('Bia contestou Mercado: “valor errado”');
  });

  it('série contestada em lote: aviso com chave de série (um só por lote)', () => {
    const inst = { seriesId: 's1', index: 3, count: 10, firstMonth: '2026-10', purchaseCents: 214000 };
    const after = expense({ description: 'Geladeira', installment: inst, status: 'returned', rejection: { byUid: B, kind: 'contest', reason: 'não combinamos' } });
    const [n] = expenseNotices(expense({ installment: inst, status: 'confirmed' }), after, 's1-3', ctx);
    expect(n).toMatchObject({ dedupeKey: 's1:returned', body: 'Bia contestou a compra Geladeira: “não combinamos”' });
  });

  it('correção vai para aprovação: avisa o outro', () => {
    const [n] = expenseNotices(expense({ status: 'returned' }), expense(), 'g1', ctx);
    expect(n).toMatchObject({ toUid: B, category: 'expenses' });
    expect(brl(n.body)).toBe('Ana corrigiu Mercado · R$ 214,00 · toque para aprovar');
    expect(expenseNotices(expense({ status: 'confirmed' }), expense(), 'g1', ctx)).toHaveLength(1);
  });

  it('valor de recorrente variável confirmado; comprovante anexado a um pendente', () => {
    const awaiting = expense({ description: 'Luz', status: 'awaiting_confirmation', recurringId: 'r1', totalCents: 0 });
    const confirmed = expenseNotices(awaiting, { ...awaiting, status: 'confirmed', totalCents: 9050, receipt: { type: 'photo' } }, 'rec', ctx)[0];
    expect(brl(confirmed.body)).toBe('Ana confirmou o valor de Luz · R$ 90,50 · foto do recibo');
    const attached = expenseNotices(expense(), expense({ status: 'confirmed', receipt: { type: 'photo' } }), 'g1', ctx)[0];
    expect(attached.body).toBe('Ana anexou o comprovante de Mercado · foto do recibo');
  });

  it('aprovar e validar (ação do outro) não avisam; edição de pendente que continua pendente também não', () => {
    expect(expenseNotices(expense(), expense({ status: 'confirmed', approval: { byUid: B } }), 'g1', ctx)).toEqual([]);
    expect(expenseNotices(expense({ status: 'confirmed' }), expense({ status: 'confirmed', approval: { byUid: B } }), 'g1', ctx)).toEqual([]);
    expect(expenseNotices(expense(), expense({ description: 'Mercado do mês' }), 'g1', ctx)).toEqual([]);
  });
});

describe('monthNotices', () => {
  const open: MonthSnapshot = { status: 'open', payments: [] };
  const payment = { id: 'p1', fromUid: A, toUid: B, amountCents: 41025, method: 'pix' as const, byUid: A };

  it('pagamento registrado: avisa quem recebe para conferir', () => {
    const [n] = monthNotices(open, { status: 'open', payments: [payment] }, '2026-10', ctx);
    expect(n).toMatchObject({ toUid: B, category: 'settlement', route: '/fechar/2026-10' });
    expect(brl(n.body)).toBe('Ana registrou o pagamento de R$ 410,25 (PIX) · confira o comprovante');
    expect(monthNotices({ status: 'open', payments: [payment] }, { status: 'open', payments: [payment] }, '2026-10', ctx)).toEqual([]);
  });

  it('mês fechado: avisa o outro', () => {
    const [n] = monthNotices(open, { status: 'closed', closedBy: B, payments: [] }, '2026-10', ctx);
    expect(n).toMatchObject({ toUid: A, body: 'Bia fechou outubro', route: '/historico/2026-10' });
  });

  it('pedido de reabertura (com motivo) e resposta', () => {
    const closed: MonthSnapshot = { status: 'closed', closedBy: B };
    const asked: MonthSnapshot = { ...closed, reopenRequest: { byUid: A, reason: 'faltou a farmácia', status: 'pending' } };
    expect(monthNotices(closed, asked, '2026-10', ctx)[0]).toMatchObject({
      toUid: B,
      body: 'Ana pediu a reabertura de outubro: “faltou a farmácia”',
    });
    const approved: MonthSnapshot = { status: 'open', reopenRequest: { byUid: A, status: 'approved', answeredBy: B } };
    expect(monthNotices(asked, approved, '2026-10', ctx)[0]).toMatchObject({
      toUid: A,
      body: 'Bia aprovou a reabertura de outubro',
      route: '/painel?mes=2026-10',
    });
    const denied: MonthSnapshot = { ...closed, reopenRequest: { byUid: A, status: 'denied', answeredBy: B } };
    expect(monthNotices(asked, denied, '2026-10', ctx)[0].body).toBe('Bia recusou a reabertura de outubro');
  });
});

describe('recurringNotices e resumo do dia 1', () => {
  const fixed: RecurringSnapshot = { description: 'Internet', kind: 'fixed', amountCents: 9900, status: 'pending_approval', active: true, createdBy: A };

  it('fixo novo para aprovar; variável não avisa', () => {
    const [n] = recurringNotices(null, fixed, 'r1', ctx);
    expect(n).toMatchObject({ toUid: B, category: 'recurring', route: '/ajustes/recorrentes/r1' });
    expect(brl(n.body)).toBe('Ana cadastrou Internet · R$ 99,00 por mês · toque para aprovar');
    expect(recurringNotices(null, { ...fixed, kind: 'variable', amountCents: undefined, status: 'approved' }, 'r2', ctx)).toEqual([]);
  });

  it('reajuste novo avisa uma vez; editar a descrição não avisa de novo', () => {
    const approved = { ...fixed, status: 'approved' as const };
    const proposal = { kind: 'fixed' as const, amountCents: 11900, payerUid: A, payerSharePct: 50 };
    const [n] = recurringNotices(approved, { ...approved, proposal }, 'r1', ctx);
    expect(brl(n.body)).toBe('Ana propôs reajuste de Internet: R$ 99,00 por mês → R$ 119,00 por mês');
    expect(recurringNotices({ ...approved, proposal }, { ...approved, description: 'Fibra', proposal }, 'r1', ctx)).toEqual([]);
  });

  it('dia 1: um aviso por pessoa que paga, resumindo os variáveis', () => {
    const notices = variableRecurringSummary([
      { payerUid: A, description: 'Luz' },
      { payerUid: A, description: 'Água' },
      { payerUid: B, description: 'Gás' },
    ]);
    expect(notices).toEqual([
      expect.objectContaining({ toUid: A, body: '2 recorrentes para confirmar o valor: Luz, Água', route: '/pendencias' }),
      expect.objectContaining({ toUid: B, body: '1 recorrente para confirmar o valor: Gás' }),
    ]);
  });
});

describe('actionCount e countLabel', () => {
  const inst = (seriesId: string) => ({ seriesId });

  it('conta só o que depende de quem vê; série conta 1', () => {
    const count = actionCount({
      viewerUid: A,
      expenses: [
        { id: 'e1', status: 'pending_approval', createdBy: B }, // para aprovar
        { id: 's-1', status: 'pending_approval', createdBy: B, installment: inst('s') }, // série = 1
        { id: 's-2', status: 'pending_approval', createdBy: B, installment: inst('s') },
        { id: 'e2', status: 'pending_approval', createdBy: A }, // aguardando o outro: não conta
        { id: 'e3', status: 'returned', createdBy: A }, // devolvido para mim
        { id: 'e4', status: 'returned', createdBy: B }, // devolvido para o outro: não conta
        { id: 'e5', status: 'awaiting_confirmation', createdBy: A }, // recorrente meu a confirmar
        { id: 'e6', status: 'awaiting_confirmation', createdBy: B },
      ],
      recurrings: [
        { active: true, status: 'pending_approval', createdBy: B }, // cadastro para aprovar
        { active: true, status: 'approved', proposal: {}, createdBy: B }, // reajuste
        { active: true, status: 'pending_approval', createdBy: A }, // meu, aguardando: não conta
        { active: false, status: 'pending_approval', createdBy: B },
      ],
      months: [
        { status: 'closed', reopenRequest: { status: 'pending', byUid: B } }, // reabertura para aprovar
        { status: 'closed', reopenRequest: { status: 'pending', byUid: A } },
      ],
    });
    expect(count).toBe(7);
  });

  it('sem pendências não mostra número; acima de 9, "9+"', () => {
    expect(countLabel(0)).toBeNull();
    expect(countLabel(9)).toBe('9');
    expect(countLabel(10)).toBe('9+');
  });
});

describe('pedido de exclusão: avisos e contador', () => {
  const confirmed = expense({ status: 'confirmed', approval: { byUid: B } });
  const pending = { byUid: A, status: 'pending' };

  it('pedido aberto: avisa o outro, com o motivo', () => {
    const [n] = expenseNotices(confirmed, { ...confirmed, deletionRequest: { ...pending, reason: 'lancei em dobro' } }, 'g1', ctx);
    expect(n).toMatchObject({ toUid: B, category: 'expenses', title: 'Exclusão para aprovar', route: '/gasto/g1' });
    expect(brl(n.body)).toBe('Ana pediu para excluir Mercado · R$ 214,00 — “lancei em dobro”');
  });

  it('pedir de novo depois de uma recusa também avisa; cancelar não avisa', () => {
    const denied = { ...pending, status: 'denied', answeredBy: B };
    expect(expenseNotices({ ...confirmed, deletionRequest: denied }, { ...confirmed, deletionRequest: pending }, 'g1', ctx)).toHaveLength(1);
    expect(expenseNotices({ ...confirmed, deletionRequest: pending }, { ...confirmed, deletionRequest: null }, 'g1', ctx)).toEqual([]);
  });

  it('recusa: avisa quem pediu', () => {
    const [n] = expenseNotices(
      { ...confirmed, deletionRequest: pending },
      { ...confirmed, deletionRequest: { ...pending, status: 'denied', answeredBy: B } },
      'g1',
      ctx,
    );
    expect(n).toMatchObject({ toUid: A, title: 'Exclusão recusada' });
    expect(n.body).toBe('Bia recusou excluir Mercado: o gasto continua no saldo');
  });

  it('aprovação (o gasto some com pedido aberto): avisa quem pediu; exclusão direta não avisa', () => {
    const [n] = expenseNotices({ ...confirmed, deletionRequest: pending }, null, 'g1', ctx);
    expect(n).toMatchObject({ toUid: A, title: 'Exclusão aprovada', route: '/painel' });
    expect(brl(n.body)).toBe('Bia aprovou a exclusão de Mercado · R$ 214,00');
    expect(expenseNotices(expense(), null, 'g1', ctx)).toEqual([]);
  });

  it('série: um aviso por lote (chave da série)', () => {
    const parcel = { ...confirmed, installment: { seriesId: 's1', index: 2, count: 3, firstMonth: '2026-10', purchaseCents: 64200 } };
    expect(expenseNotices(parcel, { ...parcel, deletionRequest: pending }, 'p2', ctx)[0].dedupeKey).toBe('s1:deletion-request');
    expect(expenseNotices({ ...parcel, deletionRequest: pending }, null, 'p2', ctx)[0].dedupeKey).toBe('s1:deleted');
  });

  it('contador: o pedido aberto conta para o outro membro (série conta 1), não para quem pediu', () => {
    const base = { recurrings: [], months: [] };
    const items = [
      { id: 'e1', status: 'confirmed' as const, createdBy: A, deletionRequest: pending },
      { id: 's1', status: 'confirmed' as const, createdBy: A, installment: { seriesId: 's1' }, deletionRequest: pending },
      { id: 's1-2', status: 'confirmed' as const, createdBy: A, installment: { seriesId: 's1' }, deletionRequest: pending },
      // Pendente já confirmado antes, com pedido aberto: conta só como exclusão.
      { id: 'e2', status: 'pending_approval' as const, createdBy: A, deletionRequest: pending },
    ];
    expect(actionCount({ viewerUid: B, expenses: items, ...base })).toBe(3);
    expect(actionCount({ viewerUid: A, expenses: items, ...base })).toBe(0);
  });
});
