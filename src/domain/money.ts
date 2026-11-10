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

/**
 * Reais inteiros SÓ para o valor dentro das etiquetas de parte ("Só minha" /
 * "Só de [nome]") na lista do Painel: arredondados para o real mais próximo,
 * com o meio subindo (12177 → "122", 129990 → "1.300"); de 1 a 49 centavos,
 * "<1". Todo o resto (o valor do gasto na lista, o saldo, Pendências, Detalhes)
 * usa formatBRL, com centavos. Só exibição; o cálculo continua em centavos.
 * Inteiro, sem float: (centavos + 50) / 100 para baixo.
 */
export function wholeReais(cents: Cents): string {
  if (cents > 0 && cents < 50) return '<1';
  const reais = Math.floor((Math.max(0, cents) + 50) / 100);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(reais);
}

