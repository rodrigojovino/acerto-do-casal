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

const brlWhole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Reais inteiros para EXIBIÇÃO na lista do Painel (v0.9.2), arredondados para o
 * real mais próximo, com o meio subindo: 12149 → 121, 12150 → 122. Todo cálculo
 * continua em centavos. Valor maior que zero que arredondaria para zero (1 a 49
 * centavos) vira "< 1". Inteiro, sem float: (centavos + 50) / 100 para baixo.
 */
export function wholeReais(cents: Cents): string {
  if (cents > 0 && cents < 50) return '<1';
  const reais = Math.floor((Math.max(0, cents) + 50) / 100);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(reais);
}

/** "R$ 121", "R$ 1.300", "R$ 0" e "< R$ 1" (ver wholeReais). Só exibição. */
export function formatBRLWhole(cents: Cents): string {
  if (cents > 0 && cents < 50) return '< R$ 1';
  return brlWhole.format(Math.floor((Math.max(0, cents) + 50) / 100)).replace(/\s/g, ' ');
}
