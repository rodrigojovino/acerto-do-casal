<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Detalhe do gasto</h1>
        </header>

        <p v-if="!loaded" class="hint">Carregando…</p>
        <p v-else-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>
        <div v-else-if="!expense" class="card missing">
          <p class="strong">Este gasto não existe mais.</p>
          <p class="hint">Ele pode ter sido excluído por quem lançou.</p>
        </div>

        <template v-else>
          <section class="summary">
            <span class="status" :class="statusClass">{{ statusText }}</span>
            <h2>{{ expense.description }}</h2>
            <p class="value num">{{ formatBRL(expense.totalCents) }}</p>
            <p class="hint big">Pago por {{ payerLabel }} · {{ formatDateBR(expense.date) }}</p>
          </section>

          <dl class="card calc">
            <div class="calc-row">
              <dt>Parte pessoal de quem pagou</dt>
              <dd class="num">{{ formatBRL(expense.personalCents) }}</dd>
            </div>
            <div class="calc-row">
              <dt>Entra no rateio</dt>
              <dd class="num">{{ formatBRL(sharedCents) }}</dd>
            </div>
            <div class="calc-row">
              <dt>Divisão (você / {{ partnerFirstName.toLowerCase() }})</dt>
              <dd class="num">{{ split.mine }} / {{ split.partner }}</dd>
            </div>
            <div class="calc-row total">
              <dt>{{ debt.label }}</dt>
              <dd class="num">{{ formatBRL(debt.amountCents) }}</dd>
            </div>
            <p class="formula hint num">{{ formula }}</p>
          </dl>

          <p v-if="competenceNote" class="hint">{{ competenceNote }}</p>

          <div class="receipt">
            <p class="strong">Nenhum comprovante anexado</p>
            <p class="hint">Por isso este gasto precisa da aprovação de {{ approverLabel }}.</p>
          </div>

          <p class="hint">
            Lançado por {{ creatorLabel }}{{ createdText }}.<br />
            <template v-if="expense.pendingWrite">Ainda não sincronizado: será enviado quando houver conexão.<br /></template>
            Já conta no saldo do mês{{ expense.status === 'confirmed' ? '' : ', destacado como pendente' }}.
          </p>

          <div class="actions">
            <p v-if="isClosed" class="hint">Mês fechado: este gasto não pode mais ser alterado.</p>
            <template v-else-if="isCreator">
              <div class="grid-2">
                <button class="btn danger" type="button" @click="confirmDelete">Excluir</button>
                <router-link class="btn primary" :to="{ name: 'gasto-editar', params: { id: expense.id } }">Editar</router-link>
              </div>
            </template>
            <p v-else class="hint">Só quem lançou edita ou exclui. Aprovar e recusar chegam na próxima fase.</p>
          </div>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, alertController } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatDateBR, monthName, monthOf } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import { splitForViewer } from '@/domain/split';
import { deleteExpense, watchExpense, type Expense } from '@/services/expenses';
import { debtView, tagFor } from '@/services/expenseView';
import { closedMonths } from '@/services/months';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

const myUid = computed(() => user.value?.uid ?? '');
const members = computed<Members>(() => [myUid.value, partnerUid.value ?? ''] as const);

// ---- Gasto em tempo real (inclusive do cache offline) ----
const expense = ref<Expense | null>(null);
const loaded = ref(false);
const loadError = ref<string | null>(null);
let stop: (() => void) | null = null;

// Fixado na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const expenseId = String(route.params.id);

watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    if (!groupId) return;
    loaded.value = false;
    stop = watchExpense(
      groupId,
      expenseId,
      (e) => {
        expense.value = e;
        loaded.value = true;
      },
      () => {
        loadError.value = 'Não foi possível carregar o gasto.';
        loaded.value = true;
      },
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

// ---- Textos e cálculo: funções de src/domain via expenseView ----
const isCreator = computed(() => expense.value?.createdBy === myUid.value);
const isClosed = computed(() => !!expense.value && closedMonths.value.has(expense.value.competence));

const payerLabel = computed(() => (expense.value ? firstNameOf(expense.value.payerUid).replace('Você', 'você') : ''));
const creatorLabel = computed(() => (expense.value ? firstNameOf(expense.value.createdBy).replace('Você', 'você') : ''));
const approverLabel = computed(() => (isCreator.value ? partnerFirstName.value : 'você'));

const statusText = computed(() => {
  if (!expense.value) return '';
  switch (tagFor(expense.value, myUid.value)) {
    case 'pending':
      return `Aguarda aprovação de ${partnerFirstName.value}`;
    case 'approve':
      return 'Aguarda sua aprovação';
    case 'returned':
      return 'Devolvido para correção';
    default:
      return 'Confirmado';
  }
});
const statusClass = computed(() => (expense.value?.status === 'confirmed' ? 'ok' : expense.value?.status));

const sharedCents = computed(() => (expense.value ? expense.value.totalCents - expense.value.personalCents : 0));

const split = computed(() =>
  expense.value
    ? splitForViewer(expense.value.payerSharePct, expense.value.payerUid, myUid.value)
    : { mine: 50, partner: 50 },
);

const debt = computed(() =>
  expense.value && partnerUid.value
    ? debtView(expense.value, members.value, myUid.value, firstNameOf)
    : { label: '', amountCents: 0 },
);

/** Memória de cálculo: rateio × parte de quem não pagou = dívida. */
const formula = computed(() => {
  const e = expense.value;
  if (!e) return '';
  const otherPct = 100 - e.payerSharePct;
  const base = e.personalCents > 0
    ? `(${formatBRL(e.totalCents)} − ${formatBRL(e.personalCents)} pessoal)`
    : formatBRL(e.totalCents);
  return `${base} × ${otherPct}% de quem não pagou = ${formatBRL(debt.value.amountCents)}`;
});

const competenceNote = computed(() => {
  const e = expense.value;
  if (!e || monthOf(e.date) === e.competence) return null;
  return `Entra no acerto de ${monthName(e.competence)}: ${monthName(monthOf(e.date))} já estava fechado quando foi lançado.`;
});

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const createdText = computed(() => {
  const at = expense.value?.createdAt;
  return at ? ` em ${dateTime.format(at).replace(', ', ' às ')}` : '';
});

// ---- Ações ----
async function confirmDelete(): Promise<void> {
  const e = expense.value;
  if (!e || !group.value) return;
  const alert = await alertController.create({
    header: 'Excluir gasto?',
    message: `"${e.description}" de ${formatBRL(e.totalCents)} sai do saldo de ${monthName(e.competence)}.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Excluir', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  // Não espera o servidor: offline, a exclusão sincroniza depois.
  deleteExpense(group.value.id, e.id);
  router.replace({ name: 'painel', query: { mes: e.competence } });
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'painel', query: expense.value ? { mes: expense.value.competence } : {} });
}
</script>

<style scoped>
.missing {
  padding: 20px;
}

.missing p {
  margin: 0 0 4px;
}

.strong {
  margin: 0;
  font-weight: 700;
}

.summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 4px;
}

.summary h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.value {
  margin: 0;
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -1px;
}

.big {
  font-size: 13px;
}

.status {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  background: #fcebd9;
  color: #8a3f00;
}

.status.returned {
  background: var(--app-danger-bg);
  color: var(--app-danger);
}

.status.ok {
  background: #e2f1e6;
  color: #1e6b3a;
}

.calc {
  margin: 0;
  display: flex;
  flex-direction: column;
}

.calc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-subtle);
  font-size: 14px;
}

.calc-row dt {
  color: var(--app-muted);
}

.calc-row dd {
  margin: 0;
  font-weight: 700;
  white-space: nowrap;
}

.calc-row.total dt {
  color: var(--app-text);
  font-weight: 700;
}

.calc-row.total dd {
  font-weight: 800;
}

.formula {
  padding: 10px 16px 12px;
}

.receipt {
  min-height: 88px;
  box-sizing: border-box;
  padding: 16px;
  border-radius: 16px;
  border: 1px dashed #a9a8a2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
  color: #3f3f3b;
  font-size: 13px;
}

.actions {
  margin-top: 8px;
}
</style>
