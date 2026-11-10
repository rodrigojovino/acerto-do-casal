import type { ItemsState } from '@/domain/nfceItemsState';
import type { NfceItems } from '../../functions/src/nfce';

/**
 * Itens da NFC-e lidos no aparelho (WebView), como o app grava em
 * `groups/{g}/nfceItems/{chave}` (`source: 'device'`). Sem acesso ao banco:
 * os testes de regras usam as mesmas funções.
 */

/** Leitura da nota no aparelho: os itens e o cabeçalho da página. */
export interface DeviceItemsRead {
  key: string;
  items: NfceItems;
  page: { issuerName: string; date: string };
}

/** Documento dos itens lidos no aparelho (`ts`: horário do servidor). */
export function deviceItemsData(read: Pick<DeviceItemsRead, 'items' | 'page'>, ts: unknown): Record<string, unknown> {
  return {
    ...read.items,
    issuerName: read.page.issuerName.slice(0, 120),
    date: read.page.date,
    fetchedAt: ts,
    source: 'device',
  };
}

/**
 * Itens que vão no lote do gasto, a partir do mesmo estado que o formulário
 * mostra: só os lidos no aparelho (os conferidos pela SEFAZ a Function grava,
 * a partir do mesmo resultado guardado que o formulário recebeu). Sem itens
 * carregados, nada.
 */
export function itemsToSave(
  key: string,
  state: ItemsState,
  page: { issuerName: string; date: string } | undefined,
): DeviceItemsRead | undefined {
  if (state.kind !== 'loaded' || state.source !== 'device' || !page) return undefined;
  return { key, items: state.items, page: { issuerName: page.issuerName, date: page.date } };
}

/**
 * O app grava os itens lidos no aparelho? Só se ainda não há itens da nota ou
 * se os que há também foram lidos no aparelho (os oficiais, do servidor,
 * nunca são trocados pelo app; as regras recusariam o lote inteiro).
 */
export function canWriteDeviceItems(existing: { source?: string } | null | undefined): boolean {
  return !existing || existing.source === 'device';
}
