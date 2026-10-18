<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{{ isEdit ? 'Editar gasto' : 'Novo gasto' }}</h1>
        </header>

        <p v-if="blocked" class="alert-error" role="alert">{{ blocked }}</p>

        <form v-else-if="ready" class="form" novalidate @submit.prevent="save">
          <div class="card amount">
            <label for="valor" class="label">Valor total</label>
            <input
              id="valor"
              class="amount-input num"
              inputmode="numeric"
              autocomplete="off"
              :value="formatBRL(totalCents)"
              :aria-invalid="showErrors && !!errors.total"
              aria-describedby="valor-erro"
              @input="onMoney($event, 'total')"
            />
            <p v-if="showErrors && errors.total" id="valor-erro" class="field-error">{{ errors.total }}</p>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="desc" class="label">Descrição</label>
              <input
                id="desc"
                v-model="description"
                class="input"
                maxlength="80"
                autocomplete="off"
                placeholder="Ex.: Mercado"
                :aria-invalid="showErrors && !!errors.description"
              />
              <p v-if="showErrors && errors.description" class="field-error">{{ errors.description }}</p>
            </div>
            <div class="field">
              <label for="data" class="label">Data</label>
              <input
                id="data"
                v-model="date"
                class="input"
                type="date"
                @input="dateTouched = true"
                :min="minDate"
                :max="maxDate"
                :aria-invalid="showErrors && !!errors.date"
              />
              <p v-if="showErrors && errors.date" class="field-error">{{ errors.date }}</p>
            </div>
          </div>

          <div class="field">
            <span id="quem-pagou" class="label">Quem pagou</span>
            <div class="segmented" role="group" aria-labelledby="quem-pagou">
              <button type="button" :aria-pressed="payerUid === myUid" @click="payerUid = myUid">Eu</button>
              <button type="button" :aria-pressed="payerUid === partnerUid" @click="payerUid = partnerUid ?? ''">
                {{ partnerFirstName }}
              </button>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="pessoal" class="label">{{ personalLabel }}</label>
              <input
                id="pessoal"
                class="input num"
                inputmode="numeric"
                autocomplete="off"
                :value="formatBRL(personalCents)"
                :aria-invalid="showErrors && !!errors.personal"
                @input="onMoney($event, 'personal')"
              />
              <p v-if="showErrors && errors.personal" class="field-error">{{ errors.personal }}</p>
            </div>
            <div class="field">
              <span id="divisao" class="label">Divisão (eu / {{ partnerFirstName.toLowerCase() }})</span>
              <div class="stepper" role="group" aria-labelledby="divisao">
                <button type="button" aria-label="Diminuir minha parte" :disabled="viewerSplit.mine <= 0" @click="step(-1)">−</button>
                <output class="num" aria-live="polite">{{ viewerSplit.mine }} / {{ viewerSplit.partner }}</output>
                <button type="button" aria-label="Aumentar minha parte" :disabled="viewerSplit.mine >= 100" @click="step(1)">+</button>
              </div>
            </div>
          </div>

          <ReceiptPicker
            ref="picker"
            v-model="receipt"
            :partner-name="partnerFirstName"
            @scanned="onScanned"
          />
          <p v-if="nfceMessage" class="nfce-msg" :class="nfceMessage.kind" role="status">{{ nfceMessage.text }}</p>

          <div class="dark-card" aria-live="polite">
            <div class="row"><span class="muted">Entra no rateio</span><span class="num"><strong>{{ formatBRL(sharedCents) }}</strong></span></div>
            <div class="row"><span class="muted">{{ preview.label }}</span><span class="num"><strong>{{ formatBRL(preview.amountCents) }}</strong></span></div>
            <div v-if="competenceNote" class="row note"><span>{{ competenceNote }}</span></div>
          </div>

          <button class="btn primary" type="submit">{{ isEdit ? 'Salvar alteração' : 'Salvar gasto' }}</button>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, onIonViewDidEnter, onIonViewWillEnter } from '@ionic/vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import ReceiptPicker, { type ReceiptState } from '@/components/ReceiptPicker.vue';
import { useRoute, useRouter } from 'vue-router';
import {
  firstDayOf,
  isIsoDate,
  lastAllowedDate,
  monthName,
  monthOf,
  resolveCompetence,
  todayInSaoPaulo,
} from '@/domain/calendar';
import { centsFromDigits, formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import { payerSharePctFromViewer, splitForViewer, stepSplit } from '@/domain/split';
import { createExpense, receiptPhotoUrl, updateExpense, watchExpense, type Expense, type ReceiptChoice } from '@/services/expenses';
import { lookupNfce, type ScannedNfce } from '@/services/nfce';
import { debtView } from '@/services/expenseView';
import { closedMonths } from '@/services/months';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

// Fixados na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const editId = route.name === 'gasto-editar' ? String(route.params.id) : null;
const isEdit = editId !== null;

const myUid = computed(() => user.value?.uid ?? '');
const members = computed<Members>(() => [myUid.value, partnerUid.value ?? ''] as const);

// ---- Estado do formulário ----
const today = ref(todayInSaoPaulo());
const totalCents = ref(0);
const personalCents = ref(0);
const description = ref('');
const date = ref(today.value);
const payerUid = ref(myUid.value);
/** Guardado como no banco: a parte de quem pagou. A tela converte com split.ts. */
const payerSharePct = ref(group.value?.defaultSplitPct ?? 50);
const showErrors = ref(false);
const receipt = ref<ReceiptState>({ type: 'none' });
const dateTouched = ref(false);
const nfceMessage = ref<{ kind: 'info' | 'ok' | 'warn'; text: string } | null>(null);
const picker = ref<InstanceType<typeof ReceiptPicker> | null>(null);
/** `?anexar=qr` (aba Pendências): abre o leitor de QR assim que o gasto carregar. */
const attachQr = route.query.anexar === 'qr';

const ready = ref(!isEdit);
const blocked = ref<string | null>(null);
let editing: Expense | null = null;
let stopWatch: (() => void) | null = null;

// Novo gasto: volta ao estado inicial a cada entrada na tela.
onIonViewWillEnter(() => {
  if (isEdit) return;
  today.value = todayInSaoPaulo();
  totalCents.value = 0;
  personalCents.value = 0;
  description.value = '';
  date.value = today.value;
  payerUid.value = myUid.value;
  payerSharePct.value = group.value?.defaultSplitPct ?? 50;
  showErrors.value = false;
  receipt.value = { type: 'none' };
  dateTouched.value = false;
  nfceMessage.value = null;
});

// Edição: carrega o gasto uma vez (também do cache offline).
if (editId && group.value) {
  stopWatch = watchExpense(
    group.value.id,
    editId,
    (expense) => {
      if (ready.value || blocked.value) return;
      if (!expense) {
        blocked.value = 'Este gasto não existe mais.';
      } else if (expense.createdBy !== myUid.value) {
        blocked.value = 'Só quem lançou o gasto pode editar.';
      } else if (closedMonths.value.has(expense.competence)) {
        blocked.value = 'Este gasto é de um mês fechado e não pode mais ser alterado.';
      } else {
        editing = expense;
        totalCents.value = expense.totalCents;
        personalCents.value = expense.personalCents;
        description.value = expense.description;
        date.value = expense.date;
        payerUid.value = expense.payerUid;
        payerSharePct.value = expense.payerSharePct;
        dateTouched.value = true;
        void loadReceipt(expense);
        ready.value = true;
        if (attachQr) setTimeout(() => void picker.value?.scanQr(), 300);
      }
    },
    () => (blocked.value = 'Não foi possível carregar o gasto.'),
  );
}
onBeforeUnmount(() => stopWatch?.());

/** Comprovante atual do gasto em edição, na forma da seção de comprovante. */
async function loadReceipt(expense: Expense): Promise<void> {
  const r = expense.receipt;
  if (r.type === 'photo') {
    receipt.value = { type: 'photo', previewUrl: null };
    const url = group.value ? await receiptPhotoUrl(group.value.id, expense) : null;
    if (receipt.value.type === 'photo' && !receipt.value.data) receipt.value = { type: 'photo', previewUrl: url };
  } else if (r.type === 'nfce') {
    const label = r.nfceData ? `Nota de ${r.nfceData.issuerName}` : 'Nota fiscal anexada (QR Code)';
    receipt.value = { type: 'nfce', nfceKey: r.nfceKey, nfceUrl: r.nfceUrl, label };
  }
}

// Novo gasto aberto pelo atalho de QR: abre o leitor ao entrar.
onIonViewDidEnter(() => {
  if (!isEdit && attachQr) void picker.value?.scanQr();
});

// ---- QR Code: pré-preenchimento pela SEFAZ (online) ----
async function onScanned(scanned: ScannedNfce): Promise<void> {
  nfceMessage.value = { kind: 'info', text: 'Consultando a nota na SEFAZ…' };
  const result = await lookupNfce(scanned.url);
  // Outro comprovante escolhido enquanto consultava: ignora.
  if (receipt.value.type !== 'nfce' || receipt.value.nfceKey !== scanned.key) return;
  if ('error' in result) {
    nfceMessage.value = { kind: 'warn', text: result.error };
    return;
  }
  const nota = result.data;
  receipt.value = { ...receipt.value, label: `Nota de ${nota.issuerName}` };
  // Preenche só o que ainda não foi digitado; nunca sobrescreve.
  if (totalCents.value === 0) totalCents.value = nota.totalCents;
  if (description.value.trim() === '') description.value = nota.issuerName.slice(0, 80);
  if (!dateTouched.value && nota.date >= minDate.value && nota.date <= maxDate.value) date.value = nota.date;

  const when = nota.date.split('-').reverse().join('/');
  nfceMessage.value =
    totalCents.value === nota.totalCents
      ? { kind: 'ok', text: `Nota de ${formatBRL(nota.totalCents)} em ${when}. Se o valor continuar igual, o gasto é confirmado sem aprovação.` }
      : { kind: 'warn', text: `Valor diferente da nota (${formatBRL(nota.totalCents)}). O gasto ficará pendente até ${partnerFirstName.value} aprovar.` };
}

// ---- Limites de data ----
const firstMonth = computed(() => {
  const created = group.value?.createdAt?.toDate();
  return created ? monthOf(todayInSaoPaulo(created)) : monthOf(today.value);
});
const minDate = computed(() => firstDayOf(firstMonth.value));
const maxDate = computed(() => lastAllowedDate(today.value));

// ---- Valores ----
function onMoney(event: Event, field: 'total' | 'personal'): void {
  const input = event.target as HTMLInputElement;
  const cents = centsFromDigits(input.value);
  if (field === 'total') totalCents.value = cents;
  else personalCents.value = cents;
  // Reescreve já formatado e mantém o cursor no fim.
  input.value = formatBRL(cents);
  input.setSelectionRange(input.value.length, input.value.length);
}

const personalLabel = computed(() =>
  payerUid.value === myUid.value ? 'Parte só minha' : `Parte só de ${partnerFirstName.value}`,
);

// ---- Divisão: sempre pela conversão de src/domain/split.ts ----
const viewerSplit = computed(() => splitForViewer(payerSharePct.value, payerUid.value, myUid.value));

function step(direction: 1 | -1): void {
  const mine = stepSplit(viewerSplit.value.mine, direction);
  payerSharePct.value = payerSharePctFromViewer(mine, payerUid.value, myUid.value);
}

// ---- Prévia do acerto (funções de domínio) ----
const sharedCents = computed(() => Math.max(0, totalCents.value - personalCents.value));

const preview = computed(() => {
  const valid = totalCents.value > 0 && personalCents.value <= totalCents.value;
  if (!valid || !partnerUid.value) return { label: 'Ninguém deve nada por este gasto', amountCents: 0 };
  return debtView(
    {
      totalCents: totalCents.value,
      personalCents: personalCents.value,
      payerUid: payerUid.value,
      payerSharePct: payerSharePct.value,
    },
    members.value,
    myUid.value,
    firstNameOf,
  );
});

const competence = computed(() =>
  isIsoDate(date.value) ? resolveCompetence(date.value, closedMonths.value, today.value) : null,
);

const competenceNote = computed(() => {
  if (!competence.value || competence.value === monthOf(date.value)) return null;
  const closed = monthName(monthOf(date.value));
  return `${closed[0].toUpperCase()}${closed.slice(1)} está fechado: este gasto entra em ${monthName(competence.value)}.`;
});

// ---- Validação ----
const errors = computed(() => {
  const e: Partial<Record<'total' | 'description' | 'date' | 'personal', string>> = {};
  if (totalCents.value <= 0) e.total = 'Informe o valor.';
  if (description.value.trim() === '') e.description = 'Informe a descrição.';
  if (!isIsoDate(date.value)) e.date = 'Informe a data.';
  else if (date.value < minDate.value || date.value > maxDate.value) e.date = 'Data fora do período permitido.';
  if (personalCents.value > totalCents.value) e.personal = 'Não pode ser maior que o total.';
  return e;
});

// ---- Ações ----
function save(): void {
  showErrors.value = true;
  if (Object.keys(errors.value).length > 0 || !group.value || !competence.value) return;

  const input = {
    description: description.value,
    totalCents: totalCents.value,
    personalCents: personalCents.value,
    payerUid: payerUid.value,
    payerSharePct: payerSharePct.value,
    date: date.value,
    receipt: receiptChoice(),
  };
  const photo = receipt.value.type === 'photo' ? receipt.value.data : undefined;
  // Não espera o servidor: offline, a gravação (e a foto) sincronizam depois.
  const result = editing
    ? updateExpense(group.value.id, editing, input, closedMonths.value, today.value, photo)
    : createExpense(group.value.id, input, myUid.value, closedMonths.value, today.value, photo);

  router.replace(
    editing
      ? { name: 'gasto', params: { id: result.id } }
      : { name: 'painel', query: { mes: result.competence } },
  );
}

function receiptChoice(): ReceiptChoice {
  const r = receipt.value;
  if (r.type === 'photo') return { type: 'photo', replaced: r.data !== undefined };
  if (r.type === 'nfce') return { type: 'nfce', nfceKey: r.nfceKey, nfceUrl: r.nfceUrl };
  return { type: 'none' };
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'painel' });
}
</script>

<style scoped>
.nfce-msg {
  margin: -4px 0 0;
  padding: 10px 12px;
  border-radius: var(--app-radius-control);
  font-size: 13px;
  font-weight: 600;
}

.nfce-msg.info {
  background: #e3eafa;
  color: var(--app-accent-dark);
}

.nfce-msg.ok {
  background: #e2f1e6;
  color: #1e6b3a;
}

.nfce-msg.warn {
  background: #fcebd9;
  color: #8a3f00;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.amount {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.amount-input {
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 30px;
  font-weight: 800;
  color: var(--app-text);
  background: transparent;
  width: 100%;
}

.amount-input:focus-visible {
  outline: none;
}

.amount:focus-within {
  border-color: var(--app-accent);
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
  color: var(--app-text);
  cursor: pointer;
}

.stepper button:disabled {
  opacity: 0.4;
  cursor: default;
}

.stepper output {
  font-size: 14px;
  font-weight: 800;
}

.note {
  margin-top: 4px;
  color: #ffd9b3;
  font-weight: 600;
}
</style>
