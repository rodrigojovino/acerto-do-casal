import { isIsoDate, lastAllowedMonth, monthOf, type IsoDate } from './calendar.js';
import { dueDate } from './recurrence.js';
import { addMonths, splitInstallments, type Cents, type Competence } from './settlement.js';

/**
 * Compra parcelada: uma parcela por mês, cada uma um gasto com
 * `installment { seriesId, index, count, firstMonth }`. A parcela 1 tem o id
 * da série; as outras, `{seriesId}-{index}`.
 */

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 48;

export interface InstallmentInfo {
  seriesId: string;
  /** 1 a count. */
  index: number;
  count: number;
  /** Mês da primeira parcela. */
  firstMonth: Competence;
}

export interface PlannedInstallment {
  index: number;
  count: number;
  totalCents: Cents;
  personalCents: Cents;
  competence: Competence;
  /** Dia da compra no mês da parcela (29 a 31 viram o último dia em meses curtos). */
  date: IsoDate;
}

/** Id do gasto de cada parcela. */
export function installmentExpenseId(seriesId: string, index: number): string {
  return index === 1 ? seriesId : `${seriesId}-${index}`;
}

/**
 * Parcelas de uma compra: valor `floor(total / n)` com o resto na primeira,
 * parte pessoal proporcional (arredondamento acumulado) e a data no dia da
 * compra em cada mês, a partir de `firstMonth`.
 */
export function planInstallments(input: {
  totalCents: Cents;
  personalCents: Cents;
  count: number;
  firstMonth: Competence;
  purchaseDate: IsoDate;
}): PlannedInstallment[] {
  const { count, purchaseDate } = input;
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    throw new RangeError(`número de parcelas deve ser de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} (recebido: ${count})`);
  }
  if (!isIsoDate(purchaseDate)) throw new RangeError(`data inválida: "${purchaseDate}"`);
  const day = Number(purchaseDate.slice(8, 10));
  return splitInstallments({
    totalCents: input.totalCents,
    personalCents: input.personalCents,
    count,
    firstCompetence: input.firstMonth,
  }).map((p) => ({ ...p, date: dueDate(p.competence, day) }));
}

/** Prévia do formulário: valor da primeira (com o resto) e das demais. */
export function installmentPreview(totalCents: Cents, count: number): { firstCents: Cents; otherCents: Cents } {
  const otherCents = Math.floor(totalCents / count);
  return { firstCents: totalCents - otherCents * (count - 1), otherCents };
}

/** Mês da última parcela da série. */
export function lastInstallmentMonth(info: Pick<InstallmentInfo, 'count' | 'firstMonth'>): Competence {
  return addMonths(info.firstMonth, info.count - 1);
}

/**
 * Último mês navegável: o mês seguinte ao atual, estendido até o mês da última
 * parcela existente (`latestInstallmentMonth`). A previsão de recorrentes não
 * estende o limite.
 */
export function navigationLastMonth(today: IsoDate, latestInstallmentMonth: Competence | null): Competence {
  const base = lastAllowedMonth(today);
  return latestInstallmentMonth && latestInstallmentMonth > base ? latestInstallmentMonth : base;
}

/** Até quantos meses atrás a primeira parcela pode ficar. */
export const MAX_PAST_FIRST_MONTHS = 6;

/**
 * O mês da primeira parcela vai do mês da compra (no máximo 6 meses atrás) até
 * o limite de lançamento. O teto para trás limita as leituras das regras
 * (cada mês passado é conferido como aberto) num lote de até 48 parcelas.
 */
export function firstMonthRange(purchaseDate: IsoDate, today: IsoDate): { min: Competence; max: Competence } {
  const oldest = addMonths(monthOf(today), -MAX_PAST_FIRST_MONTHS);
  const purchase = monthOf(purchaseDate);
  return { min: purchase > oldest ? purchase : oldest, max: lastAllowedMonth(today) };
}
