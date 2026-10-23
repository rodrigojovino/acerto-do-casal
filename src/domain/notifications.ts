import { monthName } from './calendar.js';
import { installmentSummary, type InstallmentInfo } from './installments.js';
import { formatBRL } from './money.js';
import type { Cents, Competence, ExpenseStatus } from './settlement.js';

/**
 * Avisos (push) e contador de pendências. Regras puras: a partir do antes e
 * do depois de um documento, quem recebe, o texto, a tela que o toque abre e
 * a categoria (que cada um liga ou desliga em Ajustes). O destinatário é
 * sempre o outro membro: ninguém é avisado da própria ação.
 */

export type NoticeCategory = 'expenses' | 'returns' | 'settlement' | 'recurring';

/** Limite da observação de um gasto (o mesmo das regras). */
export const MAX_NOTE = 300;

/** Resumo de uma linha da observação (Pendências e avisos): até `max` caracteres, com "…". */
export function noteSummary(note: string | undefined, max = 60): string | null {
  const text = note?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const NOTICE_CATEGORIES: readonly NoticeCategory[] = ['expenses', 'returns', 'settlement', 'recurring'];

export interface Notice {
  toUid: string;
  category: NoticeCategory;
  title: string;
  body: string;
  /** Rota do app aberta pelo toque. */
  route: string;
  /**
   * Ações em lote numa série de parcelas mudam todas as parcelas de uma vez:
   * a Function junta esta chave ao instante do lote e só a primeira parcela
   * que a registrar envia o aviso.
   */
  dedupeKey?: string;
}

export interface NoticeContext {
  members: readonly [string, string];
  /** Primeiro nome de cada membro, como o outro vê ("Queila"). */
  nameOf: (uid: string) => string;
}

const other = (ctx: NoticeContext, uid: string) => (ctx.members[0] === uid ? ctx.members[1] : ctx.members[0]);

// ---- Gastos ----

export interface ExpenseSnapshot {
  description: string;
  totalCents: Cents;
  status: ExpenseStatus;
  createdBy: string;
  receipt: { type: string; nfceKey?: string; nfceStatus?: string };
  approval?: { byUid: string };
  rejection?: { byUid: string; reason?: string; kind?: 'reject' | 'contest' };
  recurringId?: string;
  installment?: InstallmentInfo;
  note?: string;
  deletionRequest?: { byUid: string; reason?: string; status: string; answeredBy?: string } | null;
}

/** De onde veio a confirmação automática, para convidar à conferência. */
export function receiptOrigin(receipt: ExpenseSnapshot['receipt']): string | null {
  if (receipt.type === 'photo') return 'foto do recibo';
  if (receipt.type !== 'nfce') return null;
  if (receipt.nfceStatus === 'ok') return 'nota conferida';
  const doc = receipt.nfceKey?.slice(20, 22) === '55' ? 'NF-e' : 'NFC-e';
  return receipt.nfceStatus === 'pending' ? `${doc} em conferência` : doc;
}

/** "R$ 214,00" ou, numa série, "10x de R$ 214,00". */
function amountText(e: ExpenseSnapshot): string {
  return e.installment ? installmentSummary(e.installment, formatBRL).values : formatBRL(e.totalCents);
}

/** "Mercado" ou, numa série, "a compra Geladeira". */
function subject(e: ExpenseSnapshot): string {
  return e.installment ? `a compra ${e.description}` : e.description;
}

/**
 * O que vem depois do valor: aprovar (pendente) ou a origem (confirmado
 * automático), seguidos do resumo da observação, se houver.
 */
function tail(e: ExpenseSnapshot): string {
  const note = noteSummary(e.note);
  const withNote = (text: string) => `${text}${note ? ` — “${note}”` : ''}`;
  if (e.status === 'pending_approval') return withNote(' · toque para aprovar');
  if (e.status === 'confirmed' && !e.approval) {
    const origin = receiptOrigin(e.receipt);
    return withNote(origin ? ` · ${origin}` : '');
  }
  return '';
}

export function expenseNotices(
  before: ExpenseSnapshot | null,
  after: ExpenseSnapshot | null,
  expenseId: string,
  ctx: NoticeContext,
): Notice[] {
  // Excluído: só avisa quando foi a aprovação de um pedido de exclusão (para
  // quem pediu). Exclusão direta por quem lançou não avisa.
  if (!after) {
    const req = before?.deletionRequest;
    if (!before || req?.status !== 'pending') return [];
    const series = before.installment?.seriesId;
    return [
      {
        toUid: req.byUid,
        category: 'expenses',
        title: 'Exclusão aprovada',
        body: `${ctx.nameOf(other(ctx, req.byUid))} aprovou a exclusão de ${subject(before)} · ${amountText(before)}`,
        route: '/painel',
        ...(series ? { dedupeKey: `${series}:deleted` } : {}),
      },
    ];
  }
  const route = `/gasto/${expenseId}`;
  const series = after.installment?.seriesId;
  const author = after.createdBy;
  const authorName = ctx.nameOf(author);

  // Pedido de exclusão (gasto já confirmado): para o outro aprovar; recusa: para quem pediu.
  const reqBefore = before?.deletionRequest?.status ?? null;
  const reqAfter = after.deletionRequest?.status ?? null;
  if (before && reqAfter === 'pending' && reqBefore !== 'pending') {
    const reason = after.deletionRequest?.reason ? ` — “${after.deletionRequest.reason}”` : '';
    return [
      {
        toUid: other(ctx, author),
        category: 'expenses',
        title: 'Exclusão para aprovar',
        body: `${authorName} pediu para excluir ${subject(after)} · ${amountText(after)}${reason}`,
        route,
        ...(series ? { dedupeKey: `${series}:deletion-request` } : {}),
      },
    ];
  }
  if (before && reqBefore === 'pending' && reqAfter === 'denied' && after.deletionRequest?.answeredBy) {
    return [
      {
        toUid: author,
        category: 'expenses',
        title: 'Exclusão recusada',
        body: `${ctx.nameOf(after.deletionRequest.answeredBy)} recusou excluir ${subject(after)}: o gasto continua no saldo`,
        route,
        ...(series ? { dedupeKey: `${series}:deletion-denied` } : {}),
      },
    ];
  }

  // Lançamento. Recorrente gerado pela Function não avisa (o variável entra no
  // resumo do dia 1); numa série, só a parcela 1 avisa, com o valor da série.
  if (!before) {
    if (after.recurringId) return [];
    if (after.installment && after.installment.index !== 1) return [];
    return [
      {
        toUid: other(ctx, author),
        category: 'expenses',
        title: after.status === 'pending_approval' ? 'Gasto para aprovar' : 'Gasto lançado',
        body: `${authorName} lançou ${after.description} · ${amountText(after)}${tail(after)}`,
        route,
      },
    ];
  }

  if (before.status === after.status) return [];
  const dedupe = (event: string) => (series ? { dedupeKey: `${series}:${event}` } : {});

  // Devolvido: recusado (pendente) ou contestado (confirmado automático).
  if (after.status === 'returned' && after.rejection && after.rejection.byUid !== author) {
    const verb = after.rejection.kind === 'contest' ? 'contestou' : 'recusou';
    const reason = after.rejection.reason ? `: “${after.rejection.reason}”` : '';
    return [
      {
        toUid: author,
        category: 'returns',
        title: after.rejection.kind === 'contest' ? 'Gasto contestado' : 'Gasto recusado',
        body: `${ctx.nameOf(after.rejection.byUid)} ${verb} ${subject(after)}${reason}`,
        route,
        ...dedupe('returned'),
      },
    ];
  }

  // Ações de quem lançou: correção para aprovação, valor do recorrente
  // confirmado ou comprovante anexado (confirmado sem aprovação).
  const byAuthor =
    after.status === 'pending_approval' ||
    (after.status === 'confirmed' && !after.approval && (before.status === 'pending_approval' || before.status === 'awaiting_confirmation'));
  if (!byAuthor) return [];

  let body: string;
  if (before.status === 'awaiting_confirmation') {
    body = `${authorName} confirmou o valor de ${after.description} · ${amountText(after)}${tail(after)}`;
  } else if (after.status === 'confirmed') {
    body = `${authorName} anexou o comprovante de ${subject(after)}${tail(after)}`;
  } else {
    body = `${authorName} corrigiu ${subject(after)} · ${amountText(after)}${tail(after)}`;
  }
  return [
    {
      toUid: other(ctx, author),
      category: 'expenses',
      title: after.status === 'pending_approval' ? 'Gasto para aprovar' : 'Gasto atualizado',
      body,
      route,
      ...dedupe(after.status === 'pending_approval' ? 'corrected' : 'receipt'),
    },
  ];
}

// ---- Meses: acerto, fechamento e reabertura ----

export interface MonthSnapshot {
  status: 'open' | 'closed';
  payments?: ReadonlyArray<{ id: string; fromUid: string; toUid: string; amountCents: Cents; method: 'pix' | 'cash'; byUid: string }>;
  closedBy?: string;
  reopenRequest?: { byUid: string; reason?: string; status: string; answeredBy?: string };
}

export function monthNotices(
  before: MonthSnapshot | null,
  after: MonthSnapshot | null,
  month: Competence,
  ctx: NoticeContext,
): Notice[] {
  if (!after) return [];
  const notices: Notice[] = [];
  const name = monthName(month);

  // Pagamento registrado: para quem recebe conferir.
  const seen = new Set((before?.payments ?? []).map((p) => p.id));
  for (const p of after.payments ?? []) {
    if (seen.has(p.id) || p.toUid === p.byUid) continue;
    notices.push({
      toUid: p.toUid,
      category: 'settlement',
      title: 'Pagamento do acerto',
      body:
        `${ctx.nameOf(p.byUid)} registrou o pagamento de ${formatBRL(p.amountCents)} ` +
        (p.method === 'pix' ? '(PIX) · confira o comprovante' : '(dinheiro) · confira'),
      route: `/fechar/${month}`,
    });
  }

  // Mês fechado.
  if (before?.status !== 'closed' && after.status === 'closed' && after.closedBy) {
    notices.push({
      toUid: other(ctx, after.closedBy),
      category: 'settlement',
      title: 'Mês fechado',
      body: `${ctx.nameOf(after.closedBy)} fechou ${name}`,
      route: `/historico/${month}`,
    });
  }

  // Pedido de reabertura e resposta.
  const req = after.reopenRequest;
  const prev = before?.reopenRequest;
  if (req?.status === 'pending' && (prev?.status !== 'pending' || prev.byUid !== req.byUid)) {
    notices.push({
      toUid: other(ctx, req.byUid),
      category: 'settlement',
      title: 'Pedido de reabertura',
      body: `${ctx.nameOf(req.byUid)} pediu a reabertura de ${name}${req.reason ? `: “${req.reason}”` : ''}`,
      route: `/historico/${month}`,
    });
  }
  if (prev?.status === 'pending' && req && (req.status === 'approved' || req.status === 'denied') && req.answeredBy) {
    const approved = req.status === 'approved';
    notices.push({
      toUid: req.byUid,
      category: 'settlement',
      title: approved ? 'Reabertura aprovada' : 'Reabertura recusada',
      body: `${ctx.nameOf(req.answeredBy)} ${approved ? 'aprovou' : 'recusou'} a reabertura de ${name}`,
      route: approved ? `/painel?mes=${month}` : `/historico/${month}`,
    });
  }
  return notices;
}

// ---- Recorrentes ----

export interface RecurringSnapshot {
  description: string;
  kind: 'fixed' | 'variable';
  amountCents?: Cents;
  status: 'pending_approval' | 'approved' | 'returned';
  active: boolean;
  createdBy: string;
  proposal?: { kind: 'fixed' | 'variable'; amountCents?: Cents; payerUid: string; payerSharePct: number };
}

const recurringAmount = (r: { kind: string; amountCents?: Cents }) =>
  r.kind === 'fixed' ? `${formatBRL(r.amountCents ?? 0)} por mês` : 'valor variável';

const sameProposal = (a: RecurringSnapshot['proposal'], b: RecurringSnapshot['proposal']) =>
  !!a && !!b && a.kind === b.kind && a.amountCents === b.amountCents && a.payerUid === b.payerUid && a.payerSharePct === b.payerSharePct;

export function recurringNotices(
  before: RecurringSnapshot | null,
  after: RecurringSnapshot | null,
  recurringId: string,
  ctx: NoticeContext,
): Notice[] {
  if (!after || !after.active) return [];
  const route = `/ajustes/recorrentes/${recurringId}`;
  const author = ctx.nameOf(after.createdBy);
  const to = other(ctx, after.createdBy);

  // Fixo novo (ou corrigido depois de recusado) para aprovar.
  if (after.status === 'pending_approval' && before?.status !== 'pending_approval') {
    return [
      {
        toUid: to,
        category: 'recurring',
        title: 'Conta recorrente para aprovar',
        body: `${author} cadastrou ${after.description} · ${recurringAmount(after)} · toque para aprovar`,
        route,
      },
    ];
  }
  // Reajuste novo (ou trocado) para aprovar.
  if (after.status === 'approved' && after.proposal && !sameProposal(before?.proposal, after.proposal)) {
    return [
      {
        toUid: to,
        category: 'recurring',
        title: 'Reajuste para aprovar',
        body: `${author} propôs reajuste de ${after.description}: ${recurringAmount(after)} → ${recurringAmount(after.proposal)}`,
        route,
      },
    ];
  }
  return [];
}

/**
 * Resumo do dia 1, um aviso por pessoa que paga: os recorrentes variáveis
 * gerados que aguardam a confirmação do valor.
 */
export function variableRecurringSummary(generated: ReadonlyArray<{ payerUid: string; description: string }>): Notice[] {
  const byPayer = new Map<string, string[]>();
  for (const g of generated) byPayer.set(g.payerUid, [...(byPayer.get(g.payerUid) ?? []), g.description]);
  return [...byPayer].map(([payerUid, names]) => ({
    toUid: payerUid,
    category: 'recurring' as const,
    title: 'Recorrentes para confirmar',
    body:
      names.length === 1
        ? `1 recorrente para confirmar o valor: ${names[0]}`
        : `${names.length} recorrentes para confirmar o valor: ${names.join(', ')}`,
    route: '/pendencias',
  }));
}

// ---- Contador da aba Pendências (e do ícone do app) ----

export interface CountInput {
  viewerUid: string;
  /** Gastos pendentes, devolvidos ou aguardando confirmação (todos os meses). */
  expenses: ReadonlyArray<{
    id: string;
    status: ExpenseStatus;
    createdBy: string;
    installment?: { seriesId: string };
    deletionRequest?: { status: string } | null;
  }>;
  recurrings: ReadonlyArray<{ active: boolean; status: string; proposal?: unknown; createdBy: string }>;
  months: ReadonlyArray<{ status: string; reopenRequest?: { status: string; byUid: string } }>;
}

/**
 * Só o que depende de ação de quem vê: para aprovar, devolvidos para corrigir,
 * recorrentes para confirmar (variáveis, cadastros e reajustes) e reabertura
 * para aprovar. Uma série de parcelas conta 1. "Aguardando o outro aprovar" e
 * confirmados automáticos não contam.
 */
export function actionCount(input: CountInput): number {
  const { viewerUid } = input;
  const keys = new Set<string>();
  for (const e of input.expenses) {
    const mine = e.createdBy === viewerUid;
    // Pedido de exclusão aberto: conta para o outro membro (aprovar ou recusar), e só isso.
    if (e.deletionRequest?.status === 'pending') {
      if (!mine) keys.add(`deletion:${e.installment?.seriesId ?? e.id}`);
      continue;
    }
    const needsMe =
      (e.status === 'pending_approval' && !mine) ||
      (e.status === 'returned' && mine) ||
      (e.status === 'awaiting_confirmation' && mine);
    if (needsMe) keys.add(`${e.status}:${e.installment?.seriesId ?? e.id}`);
  }
  const recurring = input.recurrings.filter(
    (r) => r.active && r.createdBy !== viewerUid && (r.status === 'pending_approval' || (r.status === 'approved' && !!r.proposal)),
  ).length;
  const reopen = input.months.filter(
    (m) => m.status === 'closed' && m.reopenRequest?.status === 'pending' && m.reopenRequest.byUid !== viewerUid,
  ).length;
  return keys.size + recurring + reopen;
}

/** Texto do contador: nada sem pendências, "9+" acima de 9. */
export function countLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}
