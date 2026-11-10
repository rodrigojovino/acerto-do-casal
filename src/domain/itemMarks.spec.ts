import { describe, expect, it } from 'vitest';
import { coupleInitials, hasMarks, itemsSignature, marksMatch, readMarks, storeMarks, sumsFromMarks, type ViewerMark } from './itemMarks';

const EU = 'uid-eu';
const OUTRO = 'uid-outro';

const items = (cents: number[], discount = 0) => ({
  items: cents.map((totalCents, i) => ({ description: `ITEM ${i + 1}`, quantity: 1, unit: 'UN', unitPrice: '1,00', totalCents })),
  itemsSumCents: cents.reduce((a, b) => a + b, 0),
  discountCents: discount,
});

describe('marcações: tela (quem vê) ⇄ gasto (quem pagou)', () => {
  const marks: ViewerMark[] = ['shared', 'mine', 'partner', 'mine'];

  it('eu pago: só minha = "p" (de quem pagou), só do parceiro = "o"', () => {
    expect(storeMarks(marks, EU, EU)).toBe('spop');
  });

  it('o parceiro paga: só minha = "o" (do outro), só do parceiro = "p"', () => {
    expect(storeMarks(marks, EU, OUTRO)).toBe('sopo');
  });

  it('ida e volta para os dois pagadores; o outro vê espelhado', () => {
    for (const payer of [EU, OUTRO]) {
      const stored = storeMarks(marks, EU, payer);
      expect(readMarks(stored, EU, payer)).toEqual(marks);
      expect(readMarks(stored, OUTRO, payer)).toEqual(['shared', 'partner', 'mine', 'partner']);
    }
  });
});

describe('soma das marcações', () => {
  it('soma os itens de cada dono', () => {
    expect(sumsFromMarks(items([1000, 250, 399, 1]), ['shared', 'mine', 'partner', 'mine'])).toEqual({ mineCents: 251, partnerCents: 399 });
  });

  it('com desconto, distribui na mesma proporção e nunca passa do valor pago', () => {
    // Itens 10000, desconto 1000 (pago 9000): todos meus = 9000.
    expect(sumsFromMarks(items([4000, 6000], 1000), ['mine', 'mine'])).toEqual({ mineCents: 9000, partnerCents: 0 });
    const s = sumsFromMarks(items([333, 333, 334], 1), ['mine', 'partner', 'partner']);
    expect(s.mineCents + s.partnerCents).toBeLessThanOrEqual(999);
  });

  it('sem marcação: zero', () => {
    expect(sumsFromMarks(items([1000]), ['shared'])).toEqual({ mineCents: 0, partnerCents: 0 });
    expect(hasMarks(['shared', 'shared'])).toBe(false);
    expect(hasMarks(['shared', 'mine'])).toBe(true);
  });
});

describe('assinatura dos itens', () => {
  it('a mesma nota dá a mesma assinatura; descrição ou valor diferente muda', () => {
    const a = items([1000, 250]);
    expect(itemsSignature(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(itemsSignature(a)).toBe(itemsSignature(items([1000, 250])));
    expect(itemsSignature(items([1000, 251]))).not.toBe(itemsSignature(a));
    const renamed = { items: a.items.map((i, k) => (k === 0 ? { ...i, description: 'OUTRO' } : i)) };
    expect(itemsSignature(renamed)).not.toBe(itemsSignature(a));
  });

  it('as marcações correspondem só aos mesmos itens', () => {
    const a = items([1000, 250]);
    expect(marksMatch({ m: 'sp', sig: itemsSignature(a) }, a)).toBe(true);
    expect(marksMatch({ m: 'sp', sig: itemsSignature(a) }, items([1000, 250, 5]))).toBe(false);
    expect(marksMatch({ m: 'sp', sig: '00000000' }, a)).toBe(false);
  });
});

describe('iniciais do casal', () => {
  it('a primeira letra de cada um', () => {
    expect(coupleInitials('Rodrigo', 'Queila')).toEqual(['R', 'Q']);
  });

  it('iniciais iguais: as duas primeiras letras', () => {
    expect(coupleInitials('Rodrigo', 'Renata')).toEqual(['Ro', 'Re']);
    expect(coupleInitials('ana', 'Alice')).toEqual(['An', 'Al']);
  });
});
