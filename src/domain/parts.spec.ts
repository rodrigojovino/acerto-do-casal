import { describe, expect, it } from 'vitest';
import { partsFitTotal, payerPartsFromViewer, viewerPartsFromPayer } from './parts';

// "Só minha" e "Só de [nome]" (relativos a quem vê/lança) ⇄ banco (relativo a quem pagou).
const EU = 'uid-eu';
const ELA = 'uid-parceiro';

describe('tela → banco', () => {
  it('eu pago: pessoal = "Só minha", parceiro = "Só de [nome]"', () => {
    expect(payerPartsFromViewer({ mineCents: 1000, partnerCents: 250 }, EU, EU)).toEqual({ personalCents: 1000, partnerOnlyCents: 250 });
  });

  it('o parceiro paga: pessoal (dele) = "Só de [nome]", parceiro (eu) = "Só minha"', () => {
    expect(payerPartsFromViewer({ mineCents: 1000, partnerCents: 250 }, EU, ELA)).toEqual({ personalCents: 250, partnerOnlyCents: 1000 });
  });
});

describe('banco → tela', () => {
  it('cada um vê as partes do próprio ponto de vista, com qualquer pagador', () => {
    const stored = { personalCents: 700, partnerOnlyCents: 300 }; // pago por EU
    expect(viewerPartsFromPayer(stored, EU, EU)).toEqual({ mineCents: 700, partnerCents: 300 });
    expect(viewerPartsFromPayer(stored, ELA, EU)).toEqual({ mineCents: 300, partnerCents: 700 });
  });

  it('parte do parceiro ausente (gastos anteriores) = 0', () => {
    expect(viewerPartsFromPayer({ personalCents: 500 }, ELA, EU)).toEqual({ mineCents: 0, partnerCents: 500 });
  });

  it('ida e volta: o que foi digitado é o que aparece, para os dois pagadores e os dois que veem', () => {
    for (const payer of [EU, ELA]) {
      const typed = { mineCents: 123, partnerCents: 4567 };
      const stored = payerPartsFromViewer(typed, EU, payer);
      expect(viewerPartsFromPayer(stored, EU, payer)).toEqual(typed);
      // O outro vê espelhado.
      expect(viewerPartsFromPayer(stored, ELA, payer)).toEqual({ mineCents: 4567, partnerCents: 123 });
    }
  });
});

describe('soma máxima', () => {
  it('as duas partes somadas cabem no total', () => {
    expect(partsFitTotal({ mineCents: 600, partnerCents: 400 }, 1000)).toBe(true);
    expect(partsFitTotal({ mineCents: 600, partnerCents: 401 }, 1000)).toBe(false);
    expect(partsFitTotal({ personalCents: 0, partnerOnlyCents: 1000 }, 1000)).toBe(true);
  });
});
