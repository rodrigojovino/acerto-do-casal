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
 * se a regra recusar, guarda a mensagem para o aviso.
 */
export function trackWrite(write: Promise<unknown>, failMessage: string): void {
  inFlight.value++;
  write
    .catch((err: unknown) => {
      const code = (err as { code?: string })?.code;
      lastError.value =
        code === 'permission-denied'
          ? `${failMessage} O mês pode ter sido fechado ou o gasto mudou.`
          : `${failMessage} Tente de novo.`;
    })
    .finally(() => inFlight.value--);
}

export const isOnline = readonly(online);

/** Há gravações deste aparelho ainda não confirmadas pelo servidor. */
export const isSyncing = computed(() => inFlight.value > 0);

export const writeError = readonly(lastError);

export function clearWriteError(): void {
  lastError.value = null;
}
