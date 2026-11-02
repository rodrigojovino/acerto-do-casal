/**
 * Botão Salvar do formulário de gasto (lançar, corrigir devolvido, anexar
 * comprovante, confirmar o valor do recorrente variável). Fica desabilitado,
 * com o motivo no próprio botão, enquanto algo que o gasto precisa ainda está
 * sendo preparado no aparelho ou consultado; nunca espera o upload da foto
 * (que segue pela fila, inclusive offline). As consultas têm limite de tempo:
 * esgotado, com falha ou offline, o botão libera no plano B.
 */

/** O que o gasto espera antes de poder ser salvo. */
export type SaveWait = 'photo' | 'nfce' | 'cnpj';

/** Limite da consulta da NFC-e de SP na SEFAZ; depois, plano B (valor digitado, conferência depois). */
export const NFCE_WAIT_MS = 10_000;
/** Limite da busca do nome do emitente pelo CNPJ; depois, fica o CNPJ. */
export const CNPJ_WAIT_MS = 5_000;

export const WAIT_LABEL: Record<SaveWait, string> = {
  photo: 'Processando foto…',
  nfce: 'Consultando a nota…',
  cnpj: 'Buscando o emitente…',
};

export const SAVING_LABEL = 'Salvando…';

export interface SaveButtonState {
  disabled: boolean;
  label: string;
  /** Há espera ou gravação em andamento (para `aria-busy`). */
  busy: boolean;
}

/**
 * Estado do botão: salvando (toque duplo) > foto em processamento > nota em
 * consulta > nome do emitente em busca > livre, com o texto normal.
 */
export function saveButton(waits: readonly SaveWait[], saving: boolean, idleLabel: string): SaveButtonState {
  if (saving) return { disabled: true, label: SAVING_LABEL, busy: true };
  for (const w of ['photo', 'nfce', 'cnpj'] as const) {
    if (waits.includes(w)) return { disabled: true, label: WAIT_LABEL[w], busy: true };
  }
  return { disabled: false, label: idleLabel, busy: false };
}

/**
 * Espera `promise` até `ms`; esgotado o tempo, devolve `fallback` (a consulta
 * pode terminar depois, mas o resultado é ignorado).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Trava contra toque duplo: o primeiro toque vence e grava; os outros, até
 * `release`, não fazem nada. Nunca grava duas vezes.
 */
export function createSaveLock() {
  let locked = false;
  return {
    /** `true` se este toque pode salvar (e trava os seguintes). */
    tryLock(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    /** Libera (a pessoa desistiu no meio, ex.: fechou a escolha da categoria). */
    release(): void {
      locked = false;
    },
    get locked(): boolean {
      return locked;
    },
  };
}
