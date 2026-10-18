import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';
import { computed, ref, watch } from 'vue';
import { actionCount, countLabel } from '@/domain/notifications';
import { watchMonths, type MonthDoc } from './closing';
import { watchOpenItems, type Expense } from './expenses';
import { watchRecurring, type RecurringDoc } from './recurring';
import { group, user } from './session';

/**
 * Contador de pendências de quem vê (aba Pendências e número no ícone do app),
 * em tempo real e do cache offline, pela mesma regra das Functions.
 */

const expenses = ref<Expense[]>([]);
const recurrings = ref<RecurringDoc[]>([]);
const months = ref<MonthDoc[]>([]);
let stops: Array<() => void> = [];

watch(
  () => group.value?.id ?? null,
  (groupId) => {
    stops.forEach((s) => s());
    stops = [];
    expenses.value = [];
    recurrings.value = [];
    months.value = [];
    if (!groupId) return;
    const ignore = () => undefined;
    stops = [
      watchOpenItems(groupId, (l) => (expenses.value = l), ignore),
      watchRecurring(groupId, (l) => (recurrings.value = l), ignore),
      watchMonths(groupId, (l) => (months.value = l), ignore),
    ];
  },
  { immediate: true },
);

export const pendingCount = computed(() =>
  user.value
    ? actionCount({ viewerUid: user.value.uid, expenses: expenses.value, recurrings: recurrings.value, months: months.value })
    : 0,
);

/** "3", "9+" ou nada. */
export const pendingCountLabel = computed(() => countLabel(pendingCount.value));

// Número no ícone do app: depende do fabricante (Samsung, Xiaomi e outros
// mostram; alguns só um ponto). O aviso do FCM também leva o número.
if (Capacitor.isNativePlatform()) {
  let supported: boolean | null = null;
  watch(
    pendingCount,
    async (count) => {
      supported ??= (await Badge.isSupported().catch(() => ({ isSupported: false }))).isSupported;
      if (!supported) return;
      await (count > 0 ? Badge.set({ count }) : Badge.clear()).catch(() => undefined);
    },
    { immediate: true },
  );
}
