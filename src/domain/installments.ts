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
  /** Valor total da compra (as regras conferem o valor de cada parcela contra ele). */
  purchaseCents: Cents;
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

/**
 * Resumo da série: "10x de R$ 214,00" (ou "1ª de R$ 100,05 + 9x de R$ 100,00"),
 * com os meses da primeira e da última parcela.
 */
export function installmentSummary(
  info: Pick<InstallmentInfo, 'count' | 'firstMonth' | 'purchaseCents'>,
  format: (cents: Cents) => string,
): { values: string; firstMonth: Competence; lastMonth: Competence } {
  const { firstCents, otherCents } = installmentPreview(info.purchaseCents, info.count);
  const values =
    firstCents === otherCents
      ? `${info.count}x de ${format(otherCents)}`
      : `1ª de ${format(firstCents)} + ${info.count - 1}x de ${format(otherCents)}`;
  return { values, firstMonth: info.firstMonth, lastMonth: lastInstallmentMonth(info) };
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

/**
 * Meses que o formulário oferece para a primeira parcela, em ordem: os de
 * `firstMonthRange`, nunca antes do mês de criação do grupo. O caso comum
 * (compra no cartão em outubro, primeira parcela na fatura de novembro) é o
 * último da lista: o mês seguinte ao atual.
 */
export function firstMonthOptions(purchaseDate: IsoDate, today: IsoDate, groupFirstMonth: Competence): Competence[] {
  const range = firstMonthRange(purchaseDate, today);
  const options: Competence[] = [];
  for (let m = range.min > groupFirstMonth ? range.min : groupFirstMonth; m <= range.max; m = addMonths(m, 1)) options.push(m);
  return options;
}

/**
 * Mês da primeira parcela quando as opções mudam (data da compra, virada do
 * dia): a escolha da pessoa fica enquanto continuar permitida; sem escolha,
 * acompanha o mês da compra (a primeira opção); fora dos limites, vai para o
 * mais próximo.
 */
export function keepFirstMonth(current: Competence, chosen: boolean, options: readonly Competence[]): Competence {
  if (options.length === 0) return current;
  if (!chosen) return options[0];
  if (options.includes(current)) return current;
  return current < options[0] ? options[0] : options[options.length - 1];
}
