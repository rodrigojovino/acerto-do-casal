import { computed, readonly, ref } from 'vue';

/**
 * Estado de conexão e de gravações pendentes, para o indicador discreto
 * "Sem conexão" / "Sincronizando…".
 */

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const inFlight = ref(0);
const lastError = ref<string | null>(null);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
}

/**
 * Acompanha uma gravação do Firestore sem bloquear a tela. A promessa só
 * termina quando o servidor confirma (offline, quando a conexão volta);
 * se a regra recusar, guarda a mensagem para o aviso. `onDenied`: quem trata
 * a recusa das regras por conta própria (lançamento novo: "Lançar no mês aberto").
 */
export function trackWrite(write: Promise<unknown>, failMessage: string, onDenied?: () => void): void {
  inFlight.value++;
  write
    .catch((err: unknown) => {
      const code = (err as { code?: string })?.code;
      if (code === 'permission-denied' && onDenied) {
        onDenied();
        return;
      }
      lastError.value = code === 'permission-denied' ? deniedText(failMessage) : `${failMessage} Tente de novo.`;
    })
    .finally(() => inFlight.value--);
}

/** Texto padrão de uma gravação recusada pelas regras. */
export function deniedText(failMessage: string): string {
  return `${failMessage} O mês pode ter sido fechado ou o gasto mudou; se precisar, lance de novo com esses dados.`;
}

/** Aviso de gravação recusada com texto próprio (de quem trata a recusa em `onDenied`). */
export function reportWriteError(text: string): void {
  lastError.value = text;
}

export const isOnline = readonly(online);

/** Há gravações deste aparelho ainda não confirmadas pelo servidor. */
export const isSyncing = computed(() => inFlight.value > 0);

export const writeError = readonly(lastError);

export function clearWriteError(): void {
  lastError.value = null;
}
