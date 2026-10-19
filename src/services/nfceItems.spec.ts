import { describe, expect, it, vi } from 'vitest';

// O módulo liga um acompanhamento do Firestore ao ser importado: aqui só a linha de texto interessa.
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: vi.fn() }));
vi.mock('./session', async () => ({ group: (await import('vue')).ref(null) }));

const { itemLine } = await import('./nfceItems');
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('itemLine', () => {
  it('quantidade inteira ou fracionada, unitário como na nota, total formatado', () => {
    expect(plain(itemLine({ quantity: 2, unit: 'UN', unitPrice: '25,90', totalCents: 5180 }))).toBe('2 UN × R$ 25,90 = R$ 51,80');
    expect(plain(itemLine({ quantity: 1.535, unit: 'KG', unitPrice: '6,999', totalCents: 1074 }))).toBe('1,535 KG × R$ 6,999 = R$ 10,74');
  });
});
