import { describe, expect, it } from 'vitest';
import { formatBRLWhole, wholeReais } from './money';
import { partTagsForViewer } from './parts';

describe('valor sem centavos (lista do Painel)', () => {
  it.each([
    [12149, 'R$ 121'],
    [12150, 'R$ 122'],
    [12177, 'R$ 122'],
    [129990, 'R$ 1.300'],
    [50, 'R$ 1'],
    [0, 'R$ 0'],
    [1, '< R$ 1'],
    [49, '< R$ 1'],
    [99, 'R$ 1'],
    [100049, 'R$ 1.000'],
    [123456789, 'R$ 1.234.568'],
  ])('%i centavos → %s', (cents, text) => {
    expect(formatBRLWhole(cents)).toBe(text);
  });

  it('nas etiquetas, só o número ("100", "<1")', () => {
    expect(wholeReais(10000)).toBe('100');
    expect(wholeReais(12150)).toBe('122');
    expect(wholeReais(129990)).toBe('1.300');
    expect(wholeReais(49)).toBe('<1');
    expect(wholeReais(0)).toBe('0');
  });
});

describe('etiquetas: banco (quem pagou) → quem vê', () => {
  const A = 'uid-a';
  const B = 'uid-b';
  const e = { personalCents: 5000, partnerOnlyCents: 3000 };

  it('A pagou: A vê a pessoal como sua (preenchida) e a do parceiro como de B (vazada)', () => {
    expect(partTagsForViewer({ ...e, payerUid: A }, A, B)).toEqual([
      { owner: 'viewer', ownerUid: A, cents: 5000 },
      { owner: 'partner', ownerUid: B, cents: 3000 },
    ]);
  });

  it('o mesmo gasto visto por B: a parte de B primeiro, preenchida; os donos não mudam', () => {
    expect(partTagsForViewer({ ...e, payerUid: A }, B, A)).toEqual([
      { owner: 'viewer', ownerUid: B, cents: 3000 },
      { owner: 'partner', ownerUid: A, cents: 5000 },
    ]);
  });

  it('B pagou: a pessoal é de B e a do parceiro é de A', () => {
    expect(partTagsForViewer({ ...e, payerUid: B }, A, B)).toEqual([
      { owner: 'viewer', ownerUid: A, cents: 3000 },
      { owner: 'partner', ownerUid: B, cents: 5000 },
    ]);
  });

  it('só as partes maiores que zero; parte do parceiro ausente = 0', () => {
    expect(partTagsForViewer({ personalCents: 0, payerUid: A }, A, B)).toEqual([]);
    expect(partTagsForViewer({ personalCents: 700, payerUid: B }, A, B)).toEqual([{ owner: 'partner', ownerUid: B, cents: 700 }]);
  });
});
