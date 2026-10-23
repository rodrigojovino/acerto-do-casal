import { isIsoDate, monthOf, resolveCompetence, type IsoDate } from './calendar.js';
import type { Cents, Competence } from './settlement.js';

/**
 * Contas recorrentes: quando e como gerar o gasto de cada mês.
 * Usado pela Function agendada (geração) e pelo app (exibição).
 */

export type RecurringKind = 'fixed' | 'variable';
export type RecurringStatus = 'pending_approval' | 'approved' | 'returned';

/** O que define quanto cada um paga: mudar exige aprovação quando envolve fixo. */
export interface RecurringTerms {
  kind: RecurringKind;
  /** Só no fixo. */
  amountCents?: Cents;
  payerUid: string;
  payerSharePct: number;
}

/**
 * Os campos de dinheiro do cadastro são sempre a versão aprovada (a que a
 * geração usa); um reajuste fica em `proposal` até o outro membro aprovar.
 */
export interface Recurring {
  id: string;
  description: string;
  kind: RecurringKind;
  /** Só no fixo. */
  amountCents?: Cents;
  /** 1 a 31; dias que o mês não tem viram o último dia do mês. */
  dayOfMonth: number;
  payerUid: string;
  payerSharePct: number;
  startMonth: Competence;
  /** Sem mês final = sem prazo. */
  endMonth?: Competence;
  active: boolean;
  /** Fixo precisa de aprovação do outro membro; variável já nasce aprovado. */
  status: RecurringStatus;
  /** Último mês já gerado (gravado só pela Function): nunca gera duas vezes, nem recria um excluído. */
  lastGeneratedMonth?: Competence;
  /**
   * Reajuste proposto (valor, quem paga, divisão ou tipo) aguardando aprovação.
   * Não vale para a geração: aprovado, passa para os campos do cadastro e vale
   * a partir da próxima geração; recusado, some e a versão aprovada continua.
   */
  proposal?: RecurringTerms;
}

/** Data de vencimento num mês: dia 29 a 31 vira o último dia em meses curtos. */
export function dueDate(month: Competence, dayOfMonth: number): IsoDate {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new RangeError(`dia do mês inválido: ${dayOfMonth}`);
  }
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, '0')}`;
}

/** O mês está dentro do período do cadastro (início até o mês final, se houver). */
export function coversMonth(rec: Pick<Recurring, 'startMonth' | 'endMonth'>, month: Competence): boolean {
  return month >= rec.startMonth && (!rec.endMonth || month <= rec.endMonth);
}

/** Pode gerar: ativo e, se fixo, aprovado. */
export function canGenerate(rec: Pick<Recurring, 'active' | 'kind' | 'status'>): boolean {
  return rec.active && (rec.kind === 'variable' || rec.status === 'approved');
}

/**
 * Deve gerar o gasto do mês de `today` (fuso de São Paulo) agora? Todos os
 * recorrentes ativos do mês são gerados a partir do dia 1 (a data do gasto é
 * o dia do vencimento). A Function roda todo dia: gera no dia seguinte os
 * cadastrados ou aprovados no meio do mês e recupera execuções perdidas; um
 * mês já gerado nunca é gerado de novo.
 */
export function shouldGenerate(rec: Recurring, today: IsoDate): boolean {
  if (!isIsoDate(today)) throw new RangeError(`data inválida: "${today}"`);
  const month = monthOf(today);
  return canGenerate(rec) && coversMonth(rec, month) && (!rec.lastGeneratedMonth || rec.lastGeneratedMonth < month);
}

/** Id fixo do gasto gerado: o mesmo mês nunca vira dois documentos. */
export function recurringExpenseId(recurringId: string, month: Competence): string {
  return `rec-${recurringId}-${month}`;
}

/**
 * Gasto gerado no mês de `today`. Fixo nasce confirmado (contestável, sem
 * aprovação); variável nasce aguardando quem paga confirmar o valor. Quem
 * paga é o autor, para poder confirmar ou editar.
 */
export function recurringExpenseData<T>(
  rec: Recurring,
  today: IsoDate,
  closedMonths: ReadonlySet<Competence>,
  now: T,
) {
  const date = dueDate(monthOf(today), rec.dayOfMonth);
  const fixed = rec.kind === 'fixed';
  return {
    description: rec.description,
    totalCents: fixed ? (rec.amountCents ?? 0) : 0,
    personalCents: 0,
    payerUid: rec.payerUid,
    payerSharePct: rec.payerSharePct,
    date,
    competence: resolveCompetence(date, closedMonths, today),
    receipt: { type: 'none' as const },
    status: fixed ? ('confirmed' as const) : ('awaiting_confirmation' as const),
    // Fixo nasce confirmado: já conta como confirmado uma vez (só sai pelo pedido de exclusão).
    ...(fixed ? { everConfirmed: true as const } : {}),
    createdBy: rec.payerUid,
    createdAt: now,
    updatedAt: now,
    recurringId: rec.id,
  };
}

/** Um recorrente previsto para um mês (calculado, nada gravado no banco). */
export interface Forecast {
  recurringId: string;
  description: string;
  kind: RecurringKind;
  /** null no variável: valor a definir. */
  amountCents: Cents | null;
  date: IsoDate;
  payerUid: string;
  payerSharePct: number;
  /** Há reajuste aguardando aprovação (a previsão mostra a versão aprovada). */
  adjustmentPending: boolean;
}

/**
 * Recorrentes previstos para um mês futuro (o mês atual já tem todos gerados
 * desde o dia 1), pelas mesmas regras da geração. Não entram no saldo nem
 * estendem a navegação. Já gerados (pelo `lastGeneratedMonth` ou por existir
 * gasto do recorrente no mês) não aparecem, para nunca duplicar com o gasto real.
 */
export function forecastRecurring(
  recurrings: readonly Recurring[],
  month: Competence,
  today: IsoDate,
  generatedInMonth: ReadonlySet<string>,
): Forecast[] {
  if (month <= monthOf(today)) return [];
  return recurrings
    .filter(
      (rec) =>
        canGenerate(rec) &&
        coversMonth(rec, month) &&
        (!rec.lastGeneratedMonth || rec.lastGeneratedMonth < month) &&
        !generatedInMonth.has(rec.id),
    )
    .map((rec) => ({
      recurringId: rec.id,
      description: rec.description,
      kind: rec.kind,
      amountCents: rec.kind === 'fixed' ? (rec.amountCents ?? 0) : null,
      date: dueDate(month, rec.dayOfMonth),
      payerUid: rec.payerUid,
      payerSharePct: rec.payerSharePct,
      adjustmentPending: !!rec.proposal,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Soma prevista do mês (só os fixos; variáveis têm valor a definir). */
export function forecastTotal(forecast: readonly Forecast[]): Cents {
  return forecast.reduce((sum, f) => sum + (f.amountCents ?? 0), 0);
}
