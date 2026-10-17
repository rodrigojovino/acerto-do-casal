import { describe, expect, it } from 'vitest';
import { centsFromDigits, formatBRL } from './money';

describe('formatBRL', () => {
  it('formata centavos em reais', () => {
    expect(formatBRL(20000)).toBe('R$ 200,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });
});

describe('centsFromDigits', () => {
  it('lê os dígitos digitados como centavos', () => {
    expect(centsFromDigits('20000')).toBe(20000);
    expect(centsFromDigits('5')).toBe(5);
    expect(centsFromDigits('')).toBe(0);
  });

  it('ignora máscara, letras e zeros à esquerda', () => {
    expect(centsFromDigits('R$ 200,00')).toBe(20000);
    expect(centsFromDigits('00012a3')).toBe(123);
  });

  it('limita a 9 dígitos', () => {
    expect(centsFromDigits('12345678901')).toBe(123456789);
  });
});
