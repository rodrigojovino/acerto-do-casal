import { formatDateBR, monthOf } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { expenseDebt, type Cents, type Members, type SettlementExpense } from '@/domain/settlement';
import { splitForViewer } from '@/domain/split';
import type { Expense } from './expenses';
import type { StoredKeyEntry } from './expenseData';

/**
 * Textos de exibição de um gasto, do ponto de vista de quem olha.
 * A divisão vem sempre de `splitForViewer` (src/domain/split.ts).
 */

export type ExpenseTag = 'pending' | 'approve' | 'returned' | null;

/** Avisos extras do gasto, além da etiqueta de status. */
export type ExpenseFlag = 'nfce-diff' | 'nfce-failed' | 'nfce-checking' | 'photo-missing';

export const flagLabel: Record<ExpenseFlag, string> = {
  'nfce-diff': 'Valor diferente da nota',
  'nfce-failed': 'Nota não conferida',
  'nfce-checking': 'Conferindo nota',
  'photo-missing': 'Foto não enviada',
};

/** Avisos sobre o comprovante (nota divergente, falha na conferência, foto pendente). */
export function flagsFor(expense: Pick<Expense, 'receipt' | 'totalCents' | 'status' | 'installment'>): ExpenseFlag[] {
  const r = expense.receipt;
  if (r.type === 'nfce') {
    // Numa parcela, a nota é da compra inteira: a comparação fica no Detalhe.
    if (r.nfceStatus === 'ok' && r.nfceData && !expense.installment && r.nfceData.totalCents !== expense.totalCents) {
      return ['nfce-diff'];
    }
    if (r.nfceStatus === 'failed') return ['nfce-failed'];
    if (r.nfceStatus === 'pending') return ['nfce-checking'];
    if (r.photoPath && !r.photoUploaded) return ['photo-missing'];
  }
  if (r.type === 'photo' && !r.photoUploaded) return ['photo-missing'];
  return [];
}

/** Marca da conferência do QR da versão anterior (approval.byUid 'nfce'). */
export const NFCE_APPROVER = 'nfce';

/**
 * Confirmado sem aprovação de pessoa: pelo comprovante, recorrente fixo ou a
 * conferência do QR da versão anterior. É o único confirmado contestável.
 */
export function isAutoConfirmed(expense: Pick<Expense, 'status'> & { approval?: { byUid: string } }): boolean {
  return expense.status === 'confirmed' && (!expense.approval || expense.approval.byUid === NFCE_APPROVER);
}

/** O outro membro pode contestar (as regras também exigem mês aberto). */
export function canContest(expense: Pick<Expense, 'status' | 'approval' | 'createdBy'>, viewerUid: string): boolean {
  return expense.createdBy !== viewerUid && isAutoConfirmed(expense);
}

/** Etiqueta da lista: "Pendente" (meu), "Aprovar" (do outro), "Devolvido". */
export function tagFor(expense: Pick<Expense, 'status' | 'createdBy'>, viewerUid: string): ExpenseTag {
  if (expense.status === 'pending_approval') return expense.createdBy === viewerUid ? 'pending' : 'approve';
  if (expense.status === 'returned') return 'returned';
  return null;
}

export const tagLabel: Record<Exclude<ExpenseTag, null>, string> = {
  pending: 'Pendente',
  approve: 'Aprovar',
  returned: 'Devolvido',
};

/** Divisão "minha / do outro", ex.: "50/50" ou "30/70". */
export function splitLabel(expense: Pick<Expense, 'payerSharePct' | 'payerUid'>, viewerUid: string): string {
  const { mine, partner } = splitForViewer(expense.payerSharePct, expense.payerUid, viewerUid);
  return `${mine}/${partner}`;
}

/**
 * Linha de apoio da lista: só "quem pagou · data" ("Você · 05/10"; com o ano
 * quando a competência é outra). Divisão e parte pessoal ficam no Detalhe.
 */
export function expenseSubtitle(expense: Pick<Expense, 'date' | 'competence'>, payerName: string): string {
  return `${payerName} · ${formatDateBR(expense.date, monthOf(expense.date) !== expense.competence)}`;
}

export interface DebtView {
  /** "Bia te deve por este gasto", "Você deve por este gasto" ou "Ninguém deve nada por este gasto". */
  label: string;
  amountCents: Cents;
}

/**
 * Quem deve quanto por um gasto, do ponto de vista de quem olha. Usado pela
 * prévia do formulário e pelo Detalhe, sempre via `expenseDebt`. `subject`:
 * "esta parcela" no Detalhe de uma parcela.
 */
export function debtView(
  expense: Omit<SettlementExpense, 'status'>,
  members: Members,
  viewerUid: string,
  nameOf: (uid: string) => string,
  subject = 'este gasto',
): DebtView {
  const debt = expenseDebt({ ...expense, status: 'pending_approval' }, members);
  if (debt.amountCents === 0) return { label: `Ninguém deve nada por ${subject}`, amountCents: 0 };
  return debt.fromUid === viewerUid
    ? { label: `Você deve por ${subject}`, amountCents: debt.amountCents }
    : { label: `${nameOf(debt.fromUid)} te deve por ${subject}`, amountCents: debt.amountCents };
}

/** Tipos de selo de status (cor + ícone + texto). */
export type BadgeKind = 'pending' | 'auto' | 'photo' | 'recurring' | 'validated' | 'returned' | 'awaiting' | 'forecast' | 'deletion';

export interface Badge {
  kind: BadgeKind;
  label: string;
}

export type BadgeSource = Pick<Expense, 'status' | 'approval' | 'createdBy' | 'rejection' | 'receipt' | 'payerSharePct' | 'payerUid'> & {
  recurringId?: string;
  deletionRequest?: { status: string };
};

/**
 * Selo do confirmado automático, pela origem: QR (qualquer estado) = Automático;
 * foto = Foto do recibo; recorrente fixo gerado = Recorrente aprovado. Os três
 * são validáveis e contestáveis.
 */
function autoBadge(expense: Pick<BadgeSource, 'approval' | 'receipt' | 'recurringId'>): Badge {
  if (expense.receipt.type === 'photo') return { kind: 'photo', label: 'Foto do recibo' };
  if (expense.receipt.type === 'none' && expense.recurringId && expense.approval?.byUid !== NFCE_APPROVER) {
    return { kind: 'recurring', label: 'Recorrente aprovado' };
  }
  return { kind: 'auto', label: 'Automático' };
}

/**
 * Selo de status do ponto de vista de quem olha. `detailed`: no Detalhe, o
 * devolvido diz se foi contestado ou recusado.
 */
export function badgeFor(expense: BadgeSource, viewerUid: string, detailed = false): Badge {
  // Pedido de exclusão aberto: o selo diz isso, qualquer que seja o status.
  if (expense.deletionRequest?.status === 'pending') return { kind: 'deletion', label: 'Exclusão pedida' };
  switch (expense.status) {
    case 'pending_approval': {
      // Divisão diferente de 50/50 (vai sempre para aprovação): o selo mostra a
      // divisão, com a parte de quem vê à esquerda ("Pendente 70/30" / "Aprovar 30/70").
      const verb = expense.createdBy === viewerUid ? 'Pendente' : 'Aprovar';
      return { kind: 'pending', label: expense.payerSharePct === 50 ? verb : `${verb} ${splitLabel(expense, viewerUid)}` };
    }
    case 'returned':
      if (!detailed) return { kind: 'returned', label: 'Devolvido' };
      return { kind: 'returned', label: expense.rejection?.kind === 'contest' ? 'Contestado' : 'Recusado' };
    case 'awaiting_confirmation':
      return { kind: 'awaiting', label: 'A confirmar' };
    default:
      return isAutoConfirmed(expense) ? autoBadge(expense) : { kind: 'validated', label: 'Validado' };
  }
}

/** "NFC-e · QR Code lido", "NF-e · código de barras lido", "NFC-e · chave digitada" ("chave lida" nos antigos, sem o formato). */
export function fiscalKeyLabel(receipt: { nfceKey: string; entry?: StoredKeyEntry }): string {
  const doc = receipt.nfceKey.slice(20, 22) === '55' ? 'NF-e' : 'NFC-e';
  const how =
    receipt.entry === 'typed' ? 'chave digitada' : receipt.entry === 'qr' ? 'QR Code lido' : receipt.entry === 'barcode' ? 'código de barras lido' : 'chave lida';
  return `${doc} · ${how}`;
}

/**
 * Origem da confirmação, para o Detalhe: "Validado por Bia", "NFC-e · chave
 * lida · conferida", "NF-e · chave digitada", "Confirmado pela foto do recibo",
 * "Gerado do recorrente fixo aprovado".
 */
export function originLabel(
  expense: Pick<Expense, 'status' | 'approval' | 'receipt'> & { recurringId?: string },
  nameOf: (uid: string) => string,
): string | null {
  if (expense.status !== 'confirmed') return null;
  if (!isAutoConfirmed(expense)) return `Validado por ${nameOf(expense.approval!.byUid)}`;
  const r = expense.receipt;
  if (r.type === 'nfce') {
    const conferred = expense.approval?.byUid === NFCE_APPROVER || r.nfceStatus === 'ok';
    return `${fiscalKeyLabel(r)}${conferred ? ' · conferida' : ''}${r.photoPath ? ' · com foto' : ''}`;
  }
  if (expense.approval?.byUid === NFCE_APPROVER) return 'Automático · nota conferida';
  if (r.type === 'photo') return 'Confirmado pela foto do recibo';
  if (expense.recurringId) return 'Gerado do recorrente fixo aprovado';
  return 'Automático';
}

/** Selo de status de um recorrente previsto (calculado, ainda não gerado). */
export const FORECAST_BADGE: Badge = { kind: 'forecast', label: 'Previsto' };

/**
 * Selos de tipo, ao lado (não no lugar) do selo de status. "Recorrente" some
 * quando o status já é "Recorrente aprovado" (redundante).
 */
export function typeBadges(
  expense: Pick<Expense, 'status' | 'approval' | 'receipt'> & {
    recurringId?: string;
    installment?: { index: number; count: number };
  },
): string[] {
  const badges: string[] = [];
  if (expense.installment) badges.push(`Parcela ${expense.installment.index}/${expense.installment.count}`);
  const recurringStatus = expense.status === 'confirmed' && isAutoConfirmed(expense) && autoBadge(expense).kind === 'recurring';
  if (expense.recurringId && !recurringStatus) badges.push('Recorrente');
  return badges;
}

/**
 * Nota fiscal já usada em outro gasto: "Esta nota já foi lançada em
 * 12/10/2026 por Bia: Mercado, R$ 200,00." Numa série, o valor é o total da
 * compra e a data, a da compra (parcela 1).
 */
export function duplicateNoteText(
  other: Pick<Expense, 'description' | 'totalCents' | 'date'> & { installment?: { purchaseCents: number } },
  byName: string,
  lead = 'Esta nota já foi lançada',
): string {
  const who = byName === 'Você' ? 'você' : byName;
  const value = other.installment?.purchaseCents ?? other.totalCents;
  return `${lead} em ${formatDateBR(other.date)} por ${who}: ${other.description.trim()}, ${formatBRL(value)}.`;
}

/**
 * Identifica o gasto no aviso de gravação recusada (ex.: lançado offline num
 * mês fechado antes de sincronizar), para dar para relançar à mão:
 * "“Mercado” (R$ 50,00, 18/10/2026)".
 */
export function expenseLabel(input: { description: string; totalCents: number; date: string }): string {
  return `“${input.description.trim()}” (${formatBRL(input.totalCents)}, ${formatDateBR(input.date)})`;
}
