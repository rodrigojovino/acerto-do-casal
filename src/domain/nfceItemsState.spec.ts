import { describe, expect, it } from 'vitest';
import type { NfceItems } from '../../functions/src/nfce';
import { bestItemsRead, itemsDiffText, itemsState, itemsStatusText, type ItemsRead } from './nfceItemsState';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

const items = (cents: number[], discount = 0): NfceItems => {
  const sum = cents.reduce((a, b) => a + b, 0);
  return {
    items: cents.map((totalCents, i) => ({ description: `ITEM ${i + 1}`, quantity: 1, unit: 'UN', unitPrice: '1,00', totalCents })),
    discountCents: discount,
    totalCents: sum - discount,
    payments: [],
    itemsSumCents: sum,
    consistent: true,
  };
};

const server: ItemsRead = { source: 'server', items: items([2590, 2958]) };
const device: ItemsRead = { source: 'device', items: items([2590, 2958]) };

describe('estado dos itens no formulário', () => {
  it('carregando: consulta em andamento e ainda sem itens', () => {
    const s = itemsState({ loading: true, read: undefined, failure: undefined, expenseTotalCents: 0 });
    expect(s).toEqual({ kind: 'loading' });
    expect(itemsStatusText(s, brl)).toBe('Carregando itens da nota…');
  });

  it('carregados pela SEFAZ: quantidade, valor e origem', () => {
    const s = itemsState({ loading: false, read: server, failure: undefined, expenseTotalCents: 5548 });
    expect(s).toMatchObject({ kind: 'loaded', source: 'server', count: 2, itemsCents: 5548, diffCents: 0 });
    expect(itemsStatusText(s, brl)).toBe('Itens da nota carregados: 2 itens · R$ 55,48 · conferidos pela SEFAZ');
    expect(itemsDiffText(s, brl)).toBe('');
  });

  it('carregados no aparelho: origem sem conferência; um item no singular', () => {
    const s = itemsState({ loading: false, read: { source: 'device', items: items([1000]) }, failure: undefined, expenseTotalCents: 1000 });
    expect(itemsStatusText(s, brl)).toBe('Itens da nota carregados: 1 item · R$ 10,00 · lidos no aparelho, sem conferência');
  });

  it('itens já carregados continuam enquanto uma nova consulta roda', () => {
    expect(itemsState({ loading: true, read: server, failure: undefined, expenseTotalCents: 5548 }).kind).toBe('loaded');
  });

  it.each([
    ['blocked', 'a SEFAZ não liberou a consulta'],
    ['timeout', 'o tempo da consulta esgotou'],
    ['offline', 'sem internet'],
  ] as const)('não vieram (%s): aviso com o motivo e salvar mesmo assim', (reason, text) => {
    const s = itemsState({ loading: false, read: undefined, failure: reason, expenseTotalCents: 5548 });
    expect(s).toEqual({ kind: 'missing', reason });
    expect(itemsStatusText(s, brl)).toBe(
      `Itens da nota não carregados: ${text}. Dá para salvar mesmo assim: o valor digitado e a nota valem como comprovante.`,
    );
  });

  it('nota lida sem os itens (página sem a lista): não vieram, "a página da nota não trouxe os itens"', () => {
    const s = itemsState({ loading: false, read: { source: 'server', items: null }, failure: 'blocked', expenseTotalCents: 5548 });
    expect(s).toEqual({ kind: 'missing', reason: 'unreadable' });
  });

  it('nada tentado: sem estado', () => {
    expect(itemsState({ loading: false, read: undefined, failure: undefined, expenseTotalCents: 0 })).toEqual({ kind: 'none' });
  });
});

describe('soma dos itens contra o valor do gasto', () => {
  it('diferente: avisa antes de gravar, com a diferença', () => {
    const s = itemsState({ loading: false, read: server, failure: undefined, expenseTotalCents: 6000 });
    expect(s).toMatchObject({ diffCents: -452 });
    expect(itemsDiffText(s, brl)).toBe('A soma dos itens (R$ 55,48) difere do valor do gasto (R$ 60,00): diferença de R$ 4,52. Confira antes de salvar.');
  });

  it('com desconto: a soma dos itens menos os descontos', () => {
    const s = itemsState({ loading: false, read: { source: 'server', items: items([3000, 3000], 500) }, failure: undefined, expenseTotalCents: 5500 });
    expect(s).toMatchObject({ itemsCents: 5500, diffCents: 0 });
  });
});

describe('melhor leitura por chave', () => {
  it('uma leitura barrada depois de uma boa não apaga os itens carregados', () => {
    expect(bestItemsRead(server, undefined)).toBe(server);
    expect(bestItemsRead(server, { source: 'server', items: null })).toBe(server);
    expect(bestItemsRead(device, { source: 'device', items: null })).toBe(device);
  });

  it('conferidos pela SEFAZ valem mais que lidos no aparelho', () => {
    expect(bestItemsRead(device, server)).toBe(server);
    expect(bestItemsRead(server, device)).toBe(server);
  });

  it('qualquer leitura com itens vale mais que uma sem', () => {
    const none: ItemsRead = { source: 'server', items: null };
    expect(bestItemsRead(none, device)).toBe(device);
  });
});
