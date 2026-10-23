import { MAX_DIGITS, formatBRL } from './money.js';
import type { Cents } from './settlement.js';

/**
 * Campo de valor no estilo do app do banco. O valor é a sequência de dígitos
 * do texto formatado ("R$ 1.234,56" → 123456), ignorando "R$", pontos e
 * vírgula. Digitar insere o dígito na posição do cursor; apagar remove o
 * dígito à esquerda (ou à direita, com Delete). A posição do cursor é guardada
 * como "quantos dígitos ficam à direita dele": inserir ou apagar não muda esse
 * número, então o cursor volta ao mesmo ponto lógico mesmo quando a formatação
 * muda (aparece um ponto de milhar, some um zero à esquerda).
 */

export type MoneyEdit =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'delete' };

export interface MoneyEditResult {
  cents: Cents;
  text: string;
  caret: number;
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const digitsOf = (text: string) => [...text].filter(isDigit).join('');

/** Quantos dígitos há em `text` a partir da posição `from`. */
export function digitsRightOf(text: string, from: number): number {
  return digitsOf(text.slice(from)).length;
}

/**
 * Posição do cursor em `text` com exatamente `right` dígitos à direita: colado
 * no último dígito da esquerda, como num texto comum ("R$ 51|,00", não
 * "R$ 51,|00"). Sem dígito à esquerda: antes do primeiro dígito.
 */
export function caretForDigitsRight(text: string, right: number): number {
  const total = digitsOf(text).length;
  const left = total - Math.max(0, right);
  if (left >= total) return text.length;
  if (left <= 0) {
    const first = [...text].findIndex(isDigit);
    return first < 0 ? text.length : first;
  }
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isDigit(text[i]) && ++seen === left) return i + 1;
  }
  return text.length;
}

/** Valor e texto a partir dos dígitos; `null` se passar do limite (o campo não muda). */
function fromDigits(digits: string): { cents: Cents; text: string } | null {
  const significant = digits.replace(/^0+/, '');
  if (significant.length > MAX_DIGITS) return null;
  const cents = significant === '' ? 0 : Number(significant);
  return { cents, text: formatBRL(cents) };
}

/**
 * Aplica uma edição ao texto formatado, com a seleção de `start` a `end` (sem
 * seleção, os dois iguais). Devolve o valor, o texto novo e a posição do
 * cursor; `null` se nada mudou (tecla que não é dígito, apagar no começo,
 * passar do limite).
 */
export function applyMoneyEdit(text: string, start: number, end: number, edit: MoneyEdit): MoneyEditResult | null {
  const left = digitsOf(text.slice(0, start));
  const right = digitsOf(text.slice(end));
  const selected = end > start && digitsOf(text.slice(start, end)).length > 0;
  let newLeft = left;
  let newRight = right;
  if (edit.type === 'insert') {
    const typed = digitsOf(edit.text);
    if (typed === '') return null;
    newLeft = left + typed;
  } else if (selected) {
    // Apagar com seleção: some só o que estava selecionado.
  } else if (edit.type === 'backspace') {
    if (left === '') return null;
    newLeft = left.slice(0, -1);
  } else {
    if (right === '') return null;
    newRight = right.slice(1);
  }
  const next = fromDigits(newLeft + newRight);
  if (!next) return null;
  return { ...next, caret: caretForDigitsRight(next.text, newRight.length) };
}

/**
 * Reserva para teclados que não avisam a edição antes (`beforeinput`): a
 * partir do texto que o navegador já mudou e da posição do cursor nele,
 * reconstrói o valor e põe o cursor no mesmo ponto lógico.
 */
export function normalizeMoneyText(raw: string, caret: number): MoneyEditResult | null {
  const right = digitsRightOf(raw, caret);
  const next = fromDigits(digitsOf(raw));
  if (!next) return null;
  return { ...next, caret: caretForDigitsRight(next.text, right) };
}
