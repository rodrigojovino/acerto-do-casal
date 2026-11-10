import { describe, expect, it } from 'vitest';
import type { NfceItems } from '../../functions/src/nfce';
import { itemsState } from '@/domain/nfceItemsState';
import { canWriteDeviceItems, deviceItemsData, itemsToSave } from './nfceItemsData';

const KEY = '35261011222333000181650000000000000000000071';
const page = { issuerName: 'LOJA TESTE LTDA', date: '2026-11-08', totalCents: 5548 };
const items: NfceItems = {
  items: [{ description: 'ARROZ 5KG', quantity: 1, unit: 'UN', unitPrice: '55,48', totalCents: 5548 }],
  discountCents: 0,
  totalCents: 5548,
  payments: [{ method: 'Pix', amountCents: 5548 }],
  itemsSumCents: 5548,
  consistent: true,
};

describe('o que aparece no formulário é o que é gravado', () => {
  it('lidos no aparelho: os itens mostrados são os mesmos que vão no lote do gasto', () => {
    const state = itemsState({ loading: false, read: { source: 'device', items }, failure: undefined, expenseTotalCents: 5548 });
    const save = itemsToSave(KEY, state, page);
    expect(state.kind === 'loaded' && state.items).toBe(items);
    expect(save).toEqual({ key: KEY, items, page: { issuerName: 'LOJA TESTE LTDA', date: '2026-11-08' } });
    // O documento gravado leva exatamente a lista e os totais mostrados.
    const doc = deviceItemsData(save!, 'TS');
    expect(doc).toMatchObject({ ...items, source: 'device', fetchedAt: 'TS' });
  });

  it('conferidos pela SEFAZ: nada no lote (a Function grava os mesmos, do resultado guardado)', () => {
    const state = itemsState({ loading: false, read: { source: 'server', items }, failure: undefined, expenseTotalCents: 5548 });
    expect(itemsToSave(KEY, state, page)).toBeUndefined();
  });

  it('sem itens carregados (carregando, não vieram): nada no lote', () => {
    expect(itemsToSave(KEY, itemsState({ loading: true, read: undefined, failure: undefined, expenseTotalCents: 0 }), page)).toBeUndefined();
    expect(itemsToSave(KEY, itemsState({ loading: false, read: undefined, failure: 'blocked', expenseTotalCents: 0 }), page)).toBeUndefined();
  });

  it('itens oficiais já gravados nunca são trocados pelo app', () => {
    expect(canWriteDeviceItems(undefined)).toBe(true);
    expect(canWriteDeviceItems({ source: 'device' })).toBe(true);
    expect(canWriteDeviceItems({ source: 'checkNfce' })).toBe(false);
  });
});
