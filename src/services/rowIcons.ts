import { isAutoConfirmed, splitLabel } from './expenseView';
import type { Expense } from './expenses';

/**
 * Ícones das linhas das listas (Painel, Pendências, Detalhe do mês), no lugar
 * dos selos em texto. Na ponta direita, sempre, o indicador de situação num
 * círculo (com um ponto azul quando a próxima ação é de quem vê); antes dele,
 * em cinza: a origem do comprovante (até dois), o recorrente e os números
 * (parcela e divisão diferente de 50/50). Cada ícone leva o nome completo,
 * para leitores de tela e para o balão de "tocar e segurar".
 */

export type IndicatorKind = 'validated' | 'auto' | 'pending' | 'awaiting' | 'returned' | 'deletion' | 'forecast';
export type OriginKind = 'qr' | 'barcode' | 'typed' | 'photo' | 'none';

export interface RowIcons {
  indicator: { kind: IndicatorKind; label: string; /** A próxima ação é de quem vê. */ dot: boolean };
  /** No máximo dois (chave + foto da nota). */
  origins: Array<{ kind: OriginKind; label: string }>;
  recurring: boolean;
  /** "1/12" (ou "10x" numa série resumida em Pendências), com o nome por extenso. */
  parcel?: { text: string; label: string };
  /** Divisão diferente de 50/50, com a parte de quem vê primeiro. */
  split?: { text: string; label: string };
}

export const ORIGIN_LABEL: Record<OriginKind, string> = {
  qr: 'Origem: QR Code da nota',
  barcode: 'Origem: código de barras da nota',
  typed: 'Origem: chave da nota digitada',
  photo: 'Origem: foto do comprovante',
  none: 'Sem comprovante',
};

export const RECURRING_LABEL = 'Recorrente';

type Source = Pick<Expense, 'status' | 'approval' | 'createdBy' | 'receipt' | 'payerSharePct' | 'payerUid'> & {
  recurringId?: string;
  installment?: { index: number; count: number };
  deletionRequest?: { status: string };
};

/** Origem do comprovante: chave (QR, código de barras ou digitada) e foto; recorrente gerado sem comprovante não mostra "sem comprovante". */
export function originsOf(e: Pick<Source, 'receipt' | 'recurringId'>): RowIcons['origins'] {
  const r = e.receipt as { type: string; entry?: string; photoPath?: string };
  const list: OriginKind[] = [];
  if (r.type === 'photo') list.push('photo');
  else if (r.type === 'nfce') {
    // Gastos antigos com "lida" (sem o formato): o QR, a leitura mais comum.
    list.push(r.entry === 'barcode' ? 'barcode' : r.entry === 'typed' ? 'typed' : 'qr');
    if (r.photoPath) list.push('photo');
  } else if (!e.recurringId) list.push('none');
  return list.slice(0, 2).map((kind) => ({ kind, label: ORIGIN_LABEL[kind] }));
}

/** Indicador de situação e o ponto azul (a mesma regra do contador: a ação é de quem vê). */
export function indicatorOf(e: Source, viewerUid: string, partnerName: string): RowIcons['indicator'] {
  const mine = e.createdBy === viewerUid;
  if (e.deletionRequest?.status === 'pending') {
    return { kind: 'deletion', dot: !mine, label: mine ? `Exclusão pedida: aguarda ${partnerName}` : 'Exclusão pedida: aguarda sua resposta' };
  }
  switch (e.status) {
    case 'pending_approval':
      return { kind: 'pending', dot: !mine, label: mine ? `Aguardando aprovação de ${partnerName}` : 'Aguardando sua aprovação' };
    case 'awaiting_confirmation':
      return { kind: 'awaiting', dot: mine, label: mine ? 'A confirmar: informe o valor' : `A confirmar: aguarda ${partnerName} informar o valor` };
    case 'returned':
      return { kind: 'returned', dot: mine, label: mine ? 'Devolvido: corrija ou exclua' : `Devolvido para ${partnerName} corrigir` };
    default:
      return isAutoConfirmed(e)
        ? { kind: 'auto', dot: false, label: 'Confirmado automaticamente, ainda não conferido' }
        : { kind: 'validated', dot: false, label: 'Validado' };
  }
}

/**
 * Ícones de um gasto. `parcelText`: em Pendências, uma série resumida numa
 * linha mostra "10x" em vez de "1/10".
 */
export function rowIcons(e: Source, viewerUid: string, partnerName: string, parcelText?: string): RowIcons {
  const icons: RowIcons = {
    indicator: indicatorOf(e, viewerUid, partnerName),
    origins: originsOf(e),
    recurring: !!e.recurringId,
  };
  if (e.installment) {
    const { index, count } = e.installment;
    icons.parcel = parcelText
      ? { text: parcelText, label: `Compra parcelada em ${count} vezes` }
      : { text: `${index}/${count}`, label: `Parcela ${index} de ${count}` };
  }
  if (e.payerSharePct !== 50) {
    const text = splitLabel(e, viewerUid);
    icons.split = { text, label: `Divisão ${text}: a primeira parte é a sua` };
  }
  return icons;
}

/** Previsão de recorrente (ainda não é gasto): relógio no círculo tracejado e o ícone de repetição. */
export function forecastIcons(): RowIcons {
  return { indicator: { kind: 'forecast', dot: false, label: 'Previsto: ainda não é um gasto' }, origins: [], recurring: true };
}

/** Cadastro de recorrente aguardando aprovação (Pendências): ⚠️, com ponto azul para quem aprova. */
export function recurringApprovalIcons(createdBy: string, viewerUid: string, partnerName: string): RowIcons {
  const mine = createdBy === viewerUid;
  return {
    indicator: { kind: 'pending', dot: !mine, label: mine ? `Aguardando aprovação de ${partnerName}` : 'Aguardando sua aprovação' },
    origins: [],
    recurring: true,
  };
}

/** Legenda (Ajustes e janela de filtros): cada ícone com o nome. */
export const INDICATOR_LEGEND: Array<{ kind: IndicatorKind; label: string }> = [
  { kind: 'validated', label: 'Validado (aprovado pelo outro membro)' },
  { kind: 'auto', label: 'Confirmado automaticamente (nota, foto ou recorrente aprovado), ainda não conferido' },
  { kind: 'pending', label: 'Aguardando aprovação' },
  { kind: 'awaiting', label: 'A confirmar (falta informar o valor)' },
  { kind: 'returned', label: 'Devolvido (recusado ou contestado)' },
  { kind: 'deletion', label: 'Exclusão pedida' },
  { kind: 'forecast', label: 'Previsto (recorrente ainda não gerado)' },
];
