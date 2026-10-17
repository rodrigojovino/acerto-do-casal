import { addMonths, type Competence } from './settlement';

/** Data no formato `YYYY-MM-DD`. */
export type IsoDate = string;

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const saoPauloDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de hoje no fuso de São Paulo (`YYYY-MM-DD`). */
export function todayInSaoPaulo(now: Date = new Date()): IsoDate {
  return saoPauloDate.format(now);
}

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Mês (`YYYY-MM`) de uma data `YYYY-MM-DD`. */
export function monthOf(date: IsoDate): Competence {
  return date.slice(0, 7);
}

/** Último mês navegável e lançável: o mês seguinte ao atual. */
export function lastAllowedMonth(today: IsoDate): Competence {
  return addMonths(monthOf(today), 1);
}

/** Último dia lançável: fim do mês seguinte ao atual. */
export function lastAllowedDate(today: IsoDate): IsoDate {
  const [y, m] = lastAllowedMonth(today).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${lastAllowedMonth(today)}-${String(lastDay).padStart(2, '0')}`;
}

/** Primeiro dia do mês (para o limite inferior do seletor de data). */
export function firstDayOf(month: Competence): IsoDate {
  return `${month}-01`;
}

/**
 * Competência de um gasto: o mês da data. Se ele estiver fechado, o mês
 * aberto atual (o primeiro mês aberto a partir de hoje).
 */
export function resolveCompetence(
  date: IsoDate,
  closedMonths: ReadonlySet<Competence>,
  today: IsoDate,
): Competence {
  if (!isIsoDate(date)) throw new RangeError(`data inválida: "${date}"`);
  const dateMonth = monthOf(date);
  if (!closedMonths.has(dateMonth)) return dateMonth;

  let candidate = monthOf(today) > dateMonth ? monthOf(today) : addMonths(dateMonth, 1);
  while (closedMonths.has(candidate)) candidate = addMonths(candidate, 1);
  return candidate;
}

/** Faixa de meses navegáveis: do mês de criação do grupo ao mês seguinte ao atual. */
export function clampMonth(month: Competence, firstMonth: Competence, today: IsoDate): Competence {
  const last = lastAllowedMonth(today);
  if (month < firstMonth) return firstMonth;
  if (month > last) return last;
  return month;
}

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** "2026-10" → "Outubro 2026". */
export function monthLabel(month: Competence): string {
  const [y, m] = month.split('-').map(Number);
  return `${monthNames[m - 1]} ${y}`;
}

/** "2026-10" → "outubro". */
export function monthName(month: Competence): string {
  return monthNames[Number(month.split('-')[1]) - 1].toLowerCase();
}

/** "2026-10-05" → "05/10/2026" (ou "05/10" sem o ano). */
export function formatDateBR(date: IsoDate, withYear = true): string {
  const [y, m, d] = date.split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}
