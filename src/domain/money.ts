import type { Cents } from './settlement.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 12345 → "R$ 123,45". Formatação só na exibição; o valor fica em centavos. */
export function formatBRL(cents: Cents): string {
  // Intl separa "R$" do número com espaço não separável; normaliza para espaço comum.
  return brl.format(cents / 100).replace(/\s/g, ' ');
}

/** Até R$ 9.999.999,99. */
export const MAX_DIGITS = 9;

/**
 * Entrada de valor como no app do banco: só dígitos, os dois últimos são
 * centavos ("20000" → 20000 centavos = R$ 200,00).
 */
export function centsFromDigits(input: string): Cents {
  const digits = input.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
  return digits === '' ? 0 : Number(digits);
}
