<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{{ isNew ? 'Nova conta recorrente' : 'Conta recorrente' }}</h1>
        </header>

        <p v-if="!ready && !isNew" class="hint">Carregando…</p>
        <p v-else-if="missing" class="alert-error" role="alert">Esta conta recorrente não existe mais.</p>

        <!-- O outro membro: só leitura, com aprovar/recusar e desativar -->
        <template v-else-if="current && !isOwner">
          <section class="card summary">
            <StatusBadge v-bind="recurringBadge(current, myUid)" />
            <h2>{{ current.description }}</h2>
            <dl>
              <div><dt>Tipo</dt><dd>{{ current.kind === 'fixed' ? `Fixo · ${formatBRL(current.amountCents ?? 0)}` : 'Variável (valor confirmado a cada mês)' }}</dd></div>
              <div><dt>Vencimento</dt><dd>Dia {{ current.dayOfMonth }}</dd></div>
              <div><dt>Quem paga</dt><dd>{{ firstNameOf(current.payerUid) }}</dd></div>
              <div><dt>Divisão (você / {{ partnerFirstName.toLowerCase() }})</dt><dd>{{ viewerSplitOf(current).mine }} / {{ viewerSplitOf(current).partner }}</dd></div>
              <div><dt>Período</dt><dd>{{ periodText(current) }}</dd></div>
            </dl>
            <p class="hint">Cadastrada por {{ firstNameOf(current.createdBy) }}.</p>
            <p v-if="current.rejection && current.status === 'returned'" class="hint">Recusada por você{{ current.rejection.reason ? `: "${current.rejection.reason}"` : '' }}.</p>
          </section>

          <template v-if="current.active && current.status === 'pending_approval'">
            <label for="motivo" class="label">Motivo, se for recusar (opcional)</label>
            <input id="motivo" v-model="reason" class="input" maxlength="200" />
            <div class="grid-2">
              <button class="btn outline" type="button" @click="reject">Recusar</button>
              <button class="btn primary" type="button" @click="approve">Aprovar</button>
            </div>
            <p class="hint">Aprovada, ela gera um gasto confirmado todo mês (você ainda pode contestar cada um).</p>
          </template>
          <button v-if="current.active" class="btn danger" type="button" @click="deactivate">Desativar</button>
        </template>

        <!-- Quem cadastrou (ou cadastro novo): formulário -->
        <form v-else class="form" novalidate @submit.prevent="save">
          <p v-if="current?.status === 'returned' && current.rejection" class="alert-error">
            Recusada por {{ firstNameOf(current.rejection.byUid) }}{{ current.rejection.reason ? `: "${current.rejection.reason}"` : '' }}.
            Ajuste e salve para pedir nova aprovação.
          </p>

          <div class="field">
            <label for="desc" class="label">Descrição</label>
            <input id="desc" v-model="description" class="input" maxlength="80" placeholder="Ex.: Internet" :aria-invalid="showErrors && !!errors.description" />
            <p v-if="showErrors && errors.description" class="field-error">{{ errors.description }}</p>
          </div>

          <div class="field">
            <span id="tipo" class="label">Tipo</span>
            <div class="segmented" role="group" aria-labelledby="tipo">
              <button type="button" :aria-pressed="kind === 'fixed'" @click="kind = 'fixed'">Fixo</button>
              <button type="button" :aria-pressed="kind === 'variable'" @click="kind = 'variable'">Variável</button>
            </div>
          </div>

          <div class="grid-2">
            <div v-if="kind === 'fixed'" class="field">
              <label for="valor" class="label">Valor</label>
              <input id="valor" class="input num" inputmode="numeric" :value="formatBRL(amountCents)" :aria-invalid="showErrors && !!errors.amount" @input="onMoney" />
              <p v-if="showErrors && errors.amount" class="field-error">{{ errors.amount }}</p>
            </div>
            <div class="field">
              <label for="dia" class="label">Dia do vencimento</label>
              <input id="dia" v-model.number="dayOfMonth" class="input num" type="number" inputmode="numeric" min="1" max="31" :aria-invalid="showErrors && !!errors.day" />
              <p v-if="showErrors && errors.day" class="field-error">{{ errors.day }}</p>
            </div>
          </div>

          <div class="field">
            <span id="quem-paga" class="label">Quem paga</span>
            <div class="segmented" role="group" aria-labelledby="quem-paga">
              <button type="button" :aria-pressed="payerUid === myUid" @click="payerUid = myUid">Eu</button>
              <button type="button" :aria-pressed="payerUid === partnerUid" @click="payerUid = partnerUid ?? ''">{{ partnerFirstName }}</button>
            </div>
          </div>

          <div class="field">
            <span id="divisao" class="label">Divisão (eu / {{ partnerFirstName.toLowerCase() }})</span>
            <div class="stepper" role="group" aria-labelledby="divisao">
              <button type="button" aria-label="Diminuir minha parte" :disabled="split.mine <= 0" @click="step(-1)">−</button>
              <output class="num" aria-live="polite">{{ split.mine }} / {{ split.partner }}</output>
              <button type="button" aria-label="Aumentar minha parte" :disabled="split.mine >= 100" @click="step(1)">+</button>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="inicio" class="label">Mês inicial</label>
              <input id="inicio" v-model="startMonth" class="input" type="month" />
            </div>
            <div class="field">
              <label for="fim" class="label">Mês final</label>
              <input id="fim" v-model="endMonth" class="input" type="month" :disabled="noEnd" :aria-invalid="showErrors && !!errors.end" />
              <label class="check"><input v-model="noEnd" type="checkbox" /> Sem prazo</label>
              <p v-if="showErrors && errors.end" class="field-error">{{ errors.end }}</p>
            </div>
          </div>

          <p class="hint">{{ approvalNote }}</p>

          <button class="btn primary" type="submit">{{ isNew ? 'Cadastrar' : 'Salvar' }}</button>
          <template v-if="current">
            <button v-if="current.active" class="btn outline" type="button" @click="deactivate">Desativar</button>
            <button v-else class="btn outline" type="button" @click="reactivate">Reativar</button>
            <button class="btn danger" type="button" @click="remove">Excluir</button>
            <p class="hint">Desativar ou excluir não apaga os gastos já gerados.</p>
          </template>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, alertController } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import StatusBadge from '@/components/StatusBadge.vue';
import { monthLabel, monthOf, todayInSaoPaulo } from '@/domain/calendar';
import { centsFromDigits, formatBRL } from '@/domain/money';
import type { RecurringKind } from '@/domain/recurrence';
import { payerSharePctFromViewer, splitForViewer, stepSplit } from '@/domain/split';
import { recurringMaterialChanged, type RecurringInput } from '@/services/recurringData';
import { recurringBadge } from '@/services/recurringView';
import {
  approveRecurring,
  createRecurring,
  deactivateRecurring,
  deleteRecurring,
  rejectRecurring,
  updateRecurring,
  watchRecurring,
  type RecurringDoc,
} from '@/services/recurring';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

// Fixado na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const recurringId = route.name === 'recorrente' ? String(route.params.id) : null;
const isNew = recurringId === null;

const myUid = computed(() => user.value?.uid ?? '');

// ---- Estado do formulário ----
const description = ref('');
const kind = ref<RecurringKind>('fixed');
const amountCents = ref(0);
const dayOfMonth = ref(10);
const payerUid = ref(myUid.value);
const payerSharePct = ref(group.value?.defaultSplitPct ?? 50);
const startMonth = ref(monthOf(todayInSaoPaulo()));
const endMonth = ref('');
const noEnd = ref(true);
const showErrors = ref(false);
const reason = ref('');

// ---- Cadastro existente (em tempo real) ----
const current = ref<RecurringDoc | null>(null);
const ready = ref(isNew);
const missing = ref(false);
let filled = false;
let stop: (() => void) | null = null;

watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    if (!groupId || isNew) return;
    stop = watchRecurring(
      groupId,
      (list) => {
        const found = list.find((r) => r.id === recurringId) ?? null;
        current.value = found;
        missing.value = !found;
        ready.value = true;
        if (found && !filled) {
          filled = true;
          description.value = found.description;
          kind.value = found.kind;
          amountCents.value = found.amountCents ?? 0;
          dayOfMonth.value = found.dayOfMonth;
          payerUid.value = found.payerUid;
          payerSharePct.value = found.payerSharePct;
          startMonth.value = found.startMonth;
          endMonth.value = found.endMonth ?? '';
          noEnd.value = !found.endMonth;
        }
      },
      () => (ready.value = true),
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

const isOwner = computed(() => !current.value || current.value.createdBy === myUid.value);

// ---- Divisão: sempre pela conversão de src/domain/split.ts ----
const split = computed(() => splitForViewer(payerSharePct.value, payerUid.value, myUid.value));
function step(direction: 1 | -1): void {
  payerSharePct.value = payerSharePctFromViewer(stepSplit(split.value.mine, direction), payerUid.value, myUid.value);
}
const viewerSplitOf = (r: RecurringDoc) => splitForViewer(r.payerSharePct, r.payerUid, myUid.value);

function onMoney(event: Event): void {
  const input = event.target as HTMLInputElement;
  amountCents.value = centsFromDigits(input.value);
  input.value = formatBRL(amountCents.value);
  input.setSelectionRange(input.value.length, input.value.length);
}

function periodText(r: RecurringDoc): string {
  const from = monthLabel(r.startMonth).toLowerCase();
  return r.endMonth ? `De ${from} até ${monthLabel(r.endMonth).toLowerCase()}` : `Desde ${from}, sem prazo`;
}

function input(): RecurringInput {
  return {
    description: description.value,
    kind: kind.value,
    amountCents: kind.value === 'fixed' ? amountCents.value : undefined,
    dayOfMonth: dayOfMonth.value,
    payerUid: payerUid.value,
    payerSharePct: payerSharePct.value,
    startMonth: startMonth.value,
    endMonth: noEnd.value || !endMonth.value ? undefined : endMonth.value,
  };
}

/** Avisa quando salvar vai pedir (nova) aprovação de quem não cadastrou. */
const approvalNote = computed(() => {
  if (kind.value === 'variable') return 'Variável não precisa de aprovação: a cada mês, quem paga confirma o valor.';
  if (!current.value) return `Fixa vai para a aprovação de ${partnerFirstName.value} antes de gerar o primeiro gasto.`;
  if (current.value.status !== 'approved' || recurringMaterialChanged(input(), current.value)) {
    return `Mudar valor, quem paga, divisão ou tipo pede nova aprovação de ${partnerFirstName.value}.`;
  }
  return 'Descrição, dia e mês final mudam sem nova aprovação.';
});

const errors = computed(() => {
  const e: Partial<Record<'description' | 'amount' | 'day' | 'end', string>> = {};
  if (description.value.trim() === '') e.description = 'Informe a descrição.';
  if (kind.value === 'fixed' && amountCents.value <= 0) e.amount = 'Informe o valor.';
  if (!Number.isInteger(dayOfMonth.value) || dayOfMonth.value < 1 || dayOfMonth.value > 31) e.day = 'Dia de 1 a 31.';
  if (!noEnd.value && endMonth.value && endMonth.value < startMonth.value) e.end = 'Antes do mês inicial.';
  return e;
});

// ---- Ações (não esperam o servidor: funcionam offline) ----
function save(): void {
  showErrors.value = true;
  if (Object.keys(errors.value).length > 0 || !group.value) return;
  if (current.value) updateRecurring(group.value.id, current.value, input(), current.value.active);
  else createRecurring(group.value.id, input(), myUid.value);
  router.replace({ name: 'recorrentes' });
}

function reactivate(): void {
  if (!group.value || !current.value) return;
  updateRecurring(group.value.id, current.value, input(), true);
}

function deactivate(): void {
  if (group.value && current.value) deactivateRecurring(group.value.id, current.value.id);
}

function approve(): void {
  if (group.value && current.value) approveRecurring(group.value.id, current.value.id, myUid.value);
}

function reject(): void {
  if (!group.value || !current.value) return;
  rejectRecurring(group.value.id, current.value.id, myUid.value, reason.value);
  reason.value = '';
}

async function remove(): Promise<void> {
  if (!group.value || !current.value) return;
  const alert = await alertController.create({
    header: 'Excluir conta recorrente?',
    message: 'Os gastos já gerados continuam no histórico.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Excluir', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  deleteRecurring(group.value.id, current.value.id);
  router.replace({ name: 'recorrentes' });
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'recorrentes' });
}
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.summary dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}

.summary dt {
  color: var(--app-muted);
}

.summary dd {
  margin: 0;
  font-weight: 700;
  text-align: right;
}

.stepper {
  height: 44px;
  box-sizing: border-box;
  border-radius: var(--app-radius-control);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
}

.stepper button {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 8px;
  background: var(--app-subtle);
  font: inherit;
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
}

.stepper button:disabled {
  opacity: 0.4;
}

.stepper output {
  font-size: 14px;
  font-weight: 800;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  font-size: 13px;
  color: var(--app-muted);
}
</style>
