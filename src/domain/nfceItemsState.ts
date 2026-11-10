import type { NfceItems } from '../../functions/src/nfce.js';

/**
 * Estado dos itens da NFC-e de SP no formulário, antes de gravar: carregando,
 * carregados (conferidos pela SEFAZ ou lidos no aparelho), não carregados (com
 * o motivo) e a soma dos itens conferida contra o valor do gasto. Lógica pura,
 * com testes; a tela mostra e o Salvar grava a partir do mesmo resultado.
 */

/** De onde vieram os itens: 'server' = conferidos pela SEFAZ (a Function grava); 'device' = lidos no aparelho (vão no lote do gasto). */
export type ItemsSource = 'server' | 'device';

/** Uma leitura da nota (com ou sem os itens). */
export interface ItemsRead {
  source: ItemsSource;
  items: NfceItems | null;
}

/** Por que os itens não vieram. */
export type ItemsMissingReason = 'blocked' | 'timeout' | 'offline' | 'unreadable';

export type ItemsState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded'; source: ItemsSource; items: NfceItems; count: number; itemsCents: number; diffCents: number }
  | { kind: 'missing'; reason: ItemsMissingReason };

const rank = (r: ItemsRead | undefined): number => (!r ? 0 : r.items ? (r.source === 'server' ? 4 : 3) : r.source === 'server' ? 2 : 1);

/**
 * Melhor leitura por chave (a mesma regra das tentativas): itens conferidos
 * pela SEFAZ valem mais que os lidos no aparelho, e qualquer leitura com itens
 * vale mais que uma sem. Uma leitura barrada depois de uma boa não apaga a boa.
 */
export function bestItemsRead(prev: ItemsRead | undefined, next: ItemsRead | undefined): ItemsRead | undefined {
  return rank(next) > rank(prev) ? next : prev;
}

/** Soma dos itens menos os descontos (o que a nota diz que foi pago pelos itens). */
export function itemsCents(items: NfceItems): number {
  return items.itemsSumCents - items.discountCents;
}

/**
 * Estado mostrado no formulário:
 * - `loading`: consulta em andamento e ainda sem itens;
 * - `loaded`: a melhor leitura tem itens (com a diferença para o valor do gasto);
 * - `missing`: houve tentativa e os itens não vieram (o motivo da última falha,
 *   ou 'unreadable' se a nota veio sem os itens);
 * - `none`: nada tentado (nota que não é NFC-e de SP, ou edição sem nova leitura).
 */
export function itemsState(input: {
  loading: boolean;
  read: ItemsRead | undefined;
  failure: ItemsMissingReason | undefined;
  expenseTotalCents: number;
}): ItemsState {
  const { read } = input;
  if (read?.items) {
    const cents = itemsCents(read.items);
    return {
      kind: 'loaded',
      source: read.source,
      items: read.items,
      count: read.items.items.length,
      itemsCents: cents,
      diffCents: cents - input.expenseTotalCents,
    };
  }
  if (input.loading) return { kind: 'loading' };
  if (read) return { kind: 'missing', reason: 'unreadable' };
  if (input.failure) return { kind: 'missing', reason: input.failure };
  return { kind: 'none' };
}

const REASON_TEXT: Record<ItemsMissingReason, string> = {
  blocked: 'a SEFAZ não liberou a consulta',
  timeout: 'o tempo da consulta esgotou',
  offline: 'sem internet',
  unreadable: 'a página da nota não trouxe os itens',
};

/** Texto do estado (o mesmo na tela e no leitor de tela); `formatCents` formata reais. */
export function itemsStatusText(state: ItemsState, formatCents: (c: number) => string): string {
  switch (state.kind) {
    case 'loading':
      return 'Carregando itens da nota…';
    case 'loaded': {
      const noun = state.count === 1 ? 'item' : 'itens';
      const origin = state.source === 'server' ? 'conferidos pela SEFAZ' : 'lidos no aparelho, sem conferência';
      return `Itens da nota carregados: ${state.count} ${noun} · ${formatCents(state.itemsCents)} · ${origin}`;
    }
    case 'missing':
      return `Itens da nota não carregados: ${REASON_TEXT[state.reason]}. Dá para salvar mesmo assim: o valor digitado e a nota valem como comprovante.`;
    default:
      return '';
  }
}

/** Aviso da soma dos itens diferente do valor do gasto (vazio quando bate). */
export function itemsDiffText(state: ItemsState, formatCents: (c: number) => string): string {
  if (state.kind !== 'loaded' || state.diffCents === 0) return '';
  const expense = state.itemsCents - state.diffCents;
  return `A soma dos itens (${formatCents(state.itemsCents)}) difere do valor do gasto (${formatCents(expense)}): diferença de ${formatCents(Math.abs(state.diffCents))}. Confira antes de salvar.`;
}
