<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{{ confirmingValue ? 'Confirmar valor' : editingSeries ? 'Editar compra parcelada' : isEdit ? 'Editar gasto' : 'Novo gasto' }}</h1>
        </header>

        <p v-if="blocked" class="alert-error" role="alert">{{ blocked }}</p>

        <form v-else-if="ready" class="form" novalidate @submit.prevent="save">
          <div v-if="editingSeries" class="card series-summary">
            <p class="strong">{{ seriesSummary }}</p>
            <p class="hint">
              Muda em todas as parcelas de meses abertos: descrição, quem pagou, divisão e comprovante. Para mudar o
              valor, o número de parcelas ou o primeiro mês, exclua a compra e lance de novo.
            </p>
          </div>

          <div v-else class="card amount">
            <label for="valor" class="label">{{ installmentOn ? 'Valor total da compra' : 'Valor total' }}</label>
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
            <div v-if="!editingSeries" class="field">
              <label for="data" class="label">{{ installmentOn ? 'Data da compra' : 'Data' }}</label>
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
            <div v-if="!editingSeries" class="field">
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

          <div v-if="!isEdit" class="card installments">
            <label class="check">
              <input v-model="installmentOn" type="checkbox" />
              <span class="strong">Compra parcelada</span>
            </label>
            <template v-if="installmentOn">
              <div class="grid-2">
                <div class="field">
                  <span id="parcelas" class="label">Parcelas</span>
                  <div class="stepper" role="group" aria-labelledby="parcelas">
                    <button type="button" aria-label="Menos parcelas" :disabled="installmentCount <= MIN_INSTALLMENTS" @click="installmentCount--">−</button>
                    <output class="num" aria-live="polite">{{ installmentCount }}x</output>
                    <button type="button" aria-label="Mais parcelas" :disabled="installmentCount >= MAX_INSTALLMENTS" @click="installmentCount++">+</button>
                  </div>
                </div>
                <div class="field">
                  <label for="primeira" class="label">Mês da primeira</label>
                  <input
                    id="primeira"
                    v-model="installmentFirstMonth"
                    class="input"
                    type="month"
                    @input="firstMonthTouched = true"
                    :min="firstMonthBounds.min"
                    :max="firstMonthBounds.max"
                    :aria-invalid="showErrors && !!errors.firstMonth"
                  />
                  <p v-if="showErrors && errors.firstMonth" class="field-error">{{ errors.firstMonth }}</p>
                </div>
              </div>
              <p class="hint" aria-live="polite">{{ installmentText }}</p>
              <p class="hint">O comprovante da compra vale para todas as parcelas; sem ele, a série inteira vai para aprovação uma vez.</p>
            </template>
          </div>

          <div class="field">
            <label for="obs" class="label">Observação (opcional)</label>
            <textarea
              id="obs"
              v-model="note"
              class="input note"
              rows="2"
              :maxlength="MAX_NOTE"
              placeholder="Ex.: churrasco do sábado, dividido com a família"
            />
            <p class="hint counter" aria-live="polite">{{ note.length }}/{{ MAX_NOTE }}</p>
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
            <div v-if="competenceNote && !installmentOn" class="row note"><span>{{ competenceNote }}</span></div>
            <div v-if="installmentOn" class="row note"><span>Na compra inteira; cada parcela entra no acerto do mês dela.</span></div>
          </div>

          <button class="btn primary" type="submit">{{ isEdit ? 'Salvar alteração' : 'Salvar gasto' }}</button>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, onIonViewDidEnter, onIonViewWillEnter } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ReceiptPicker, { type ReceiptState } from '@/components/ReceiptPicker.vue';
import { useRoute, useRouter } from 'vue-router';
import {
  firstDayOf,
  isIsoDate,
  lastAllowedDate,
  monthLabel,
  monthName,
  monthOf,
  resolveCompetence,
  todayInSaoPaulo,
} from '@/domain/calendar';
import { centsFromDigits, formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import { payerSharePctFromViewer, splitForViewer, stepSplit } from '@/domain/split';
import {
  createExpense,
  createInstallmentSeries,
  receiptPhotoUrl,
  updateExpense,
  updateSeries,
  watchExpense,
  watchSeries,
  type Expense,
  type ReceiptChoice,
} from '@/services/expenses';
import {
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
  firstMonthRange,
  installmentPreview,
  lastInstallmentMonth,
} from '@/domain/installments';
import { seriesTargets } from '@/services/series';
import { MAX_NOTE } from '@/domain/notifications';
import { fiscalDocName, formatCnpj, lookupCnpjName, lookupNfce, type ScannedNfce } from '@/services/nfce';
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
const note = ref('');
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

// Compra parcelada (lançamento novo)
const installmentOn = ref(false);
const installmentCount = ref(MIN_INSTALLMENTS);
const installmentFirstMonth = ref(monthOf(today.value));

const ready = ref(!isEdit);
/** Edição de uma parcela = edição da série (parcelas de meses abertos). */
const editingSeries = ref(false);
const seriesParcels = ref<Expense[]>([]);
let stopSeries: (() => void) | null = null;
/** Recorrente variável aguardando quem paga confirmar o valor. */
const confirmingValue = ref(false);
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
  note.value = '';
  date.value = today.value;
  payerUid.value = myUid.value;
  payerSharePct.value = group.value?.defaultSplitPct ?? 50;
  showErrors.value = false;
  receipt.value = { type: 'none' };
  dateTouched.value = false;
  nfceMessage.value = null;
  installmentOn.value = false;
  installmentCount.value = MIN_INSTALLMENTS;
  installmentFirstMonth.value = monthOf(today.value);
  firstMonthTouched.value = false;
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
        confirmingValue.value = expense.status === 'awaiting_confirmation';
        if (expense.installment && group.value) {
          editingSeries.value = true;
          stopSeries = watchSeries(group.value.id, expense.installment.seriesId, (list) => (seriesParcels.value = list), () => undefined);
        }
        totalCents.value = expense.totalCents;
        personalCents.value = expense.personalCents;
        description.value = expense.description;
        note.value = expense.note ?? '';
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
onBeforeUnmount(() => {
  stopWatch?.();
  stopSeries?.();
});

/** Comprovante atual do gasto em edição, na forma da seção de comprovante. */
async function loadReceipt(expense: Expense): Promise<void> {
  const r = expense.receipt;
  if (r.type === 'photo') {
    receipt.value = { type: 'photo', previewUrl: null };
    const url = group.value ? await receiptPhotoUrl(group.value.id, expense) : null;
    if (receipt.value.type === 'photo' && !receipt.value.data) receipt.value = { type: 'photo', previewUrl: url };
  } else if (r.type === 'nfce') {
    const doc = fiscalDocName(r.nfceKey.slice(20, 22));
    const label = r.nfceData ? `${doc} de ${r.nfceData.issuerName}` : `${doc} anexada (chave ${r.entry === 'typed' ? 'digitada' : 'lida'})`;
    receipt.value = { type: 'nfce', nfceKey: r.nfceKey, entry: r.entry ?? 'read', spUrl: r.nfceUrl ?? null, label };
    if (r.photoPath) {
      // Foto da nota já anexada: mostra a prévia quando carregar.
      receipt.value = { ...receipt.value, photo: { previewUrl: null } };
      const url = group.value ? await receiptPhotoUrl(group.value.id, expense) : null;
      if (receipt.value.type === 'nfce' && receipt.value.photo && !receipt.value.photo.data) {
        receipt.value = { ...receipt.value, photo: { previewUrl: url } };
      }
    }
  }
}

// Novo gasto aberto pelo atalho de QR: abre o leitor ao entrar.
onIonViewDidEnter(() => {
  if (!isEdit && attachQr) void picker.value?.scanQr();
});

// ---- Chave lida ou digitada: pré-preenchimento (NFC-e de SP pela SEFAZ, online) ----
async function onScanned(scanned: ScannedNfce): Promise<void> {
  // Pela chave (qualquer estado, sem rede): emitente (CNPJ) e mês de emissão.
  const doc = fiscalDocName(scanned.model);
  const provisional = `${doc} ${scanned.uf} · CNPJ ${formatCnpj(scanned.cnpj)}`;
  if (description.value.trim() === '') description.value = provisional;
  if (!dateTouched.value && monthOf(date.value) !== scanned.yearMonth) {
    // A chave traz só o mês: usa o último dia dele (ou hoje, se for o mês atual) e pede para conferir o dia.
    const [y, m] = scanned.yearMonth.split('-').map(Number);
    const lastDay = `${scanned.yearMonth}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const candidate = lastDay < today.value ? lastDay : today.value;
    if (candidate >= minDate.value && candidate <= maxDate.value) date.value = candidate;
  }

  if (!scanned.spUrl) {
    nfceMessage.value = {
      kind: 'warn',
      text:
        scanned.model === '55'
          ? 'NF-e: digite o valor e confira a data. Não há conferência automática (a consulta de NF-e exige captcha).'
          : `Nota de ${scanned.uf}: digite o valor e confira a data. A conferência automática é só para SP.`,
    };
    await fillIssuerName(scanned, provisional);
    return;
  }

  nfceMessage.value = { kind: 'info', text: 'Consultando a nota na SEFAZ…' };
  const result = await lookupNfce(scanned.spUrl);
  // Outro comprovante escolhido enquanto consultava: ignora.
  if (receipt.value.type !== 'nfce' || receipt.value.nfceKey !== scanned.key) return;
  if ('error' in result) {
    nfceMessage.value = { kind: 'warn', text: result.error };
    await fillIssuerName(scanned, provisional);
    return;
  }
  const nota = result.data;
  receipt.value = { ...receipt.value, label: `Nota de ${nota.issuerName}` };
  // Preenche só o que ainda não foi digitado; nunca sobrescreve. A descrição
  // provisória da chave ("Nota fiscal SP · CNPJ …") é trocada pelo emitente.
  if (totalCents.value === 0) totalCents.value = nota.totalCents;
  if (description.value.trim() === '' || description.value.startsWith('NFC-e SP · CNPJ')) {
    description.value = nota.issuerName.slice(0, 80);
  }
  if (!dateTouched.value && nota.date >= minDate.value && nota.date <= maxDate.value) date.value = nota.date;

  const when = nota.date.split('-').reverse().join('/');
  nfceMessage.value =
    totalCents.value === nota.totalCents
      ? { kind: 'ok', text: `Nota de ${formatBRL(nota.totalCents)} em ${when}.` }
      : { kind: 'warn', text: `Valor diferente da nota (${formatBRL(nota.totalCents)}). ${partnerFirstName.value} verá o aviso e poderá contestar.` };
}

/**
 * Sem consulta à SEFAZ (ou com falha): troca a descrição provisória pelo nome
 * do emitente (CNPJ). Só se a pessoa ainda não mexeu na descrição; ela pode
 * editar depois. Offline ou com falha, fica o CNPJ formatado.
 */
async function fillIssuerName(scanned: ScannedNfce, provisional: string): Promise<void> {
  const name = await lookupCnpjName(scanned.cnpj);
  // Outro comprovante escolhido enquanto consultava, ou descrição já editada: ignora.
  if (!name || receipt.value.type !== 'nfce' || receipt.value.nfceKey !== scanned.key) return;
  if (description.value === provisional) description.value = name.slice(0, 80);
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

// ---- Compra parcelada ----
const firstMonthBounds = computed(() => {
  const range = isIsoDate(date.value) ? firstMonthRange(date.value, today.value) : { min: firstMonth.value, max: monthOf(maxDate.value) };
  return { min: range.min > firstMonth.value ? range.min : firstMonth.value, max: range.max };
});

// A primeira parcela acompanha o mês da compra até a pessoa escolher outro mês.
const firstMonthTouched = ref(false);
watch(firstMonthBounds, (bounds) => {
  const m = firstMonthTouched.value ? installmentFirstMonth.value : bounds.min;
  installmentFirstMonth.value = m < bounds.min ? bounds.min : m > bounds.max ? bounds.max : m;
});

const shortMonth = (m: string) => monthLabel(m).toLowerCase().replace(/^(\S{3})\S* /, '$1/');

/** "10x · 1ª de R$ 100,05 e 9 de R$ 100,00 · de out/2026 a jul/2027". */
const installmentText = computed(() => {
  const n = installmentCount.value;
  if (totalCents.value <= 0) return `${n} parcelas, uma por mês.`;
  const { firstCents, otherCents } = installmentPreview(totalCents.value, n);
  const values = firstCents === otherCents
    ? `${n}x de ${formatBRL(otherCents)}`
    : `${n}x · 1ª de ${formatBRL(firstCents)} e ${n - 1} de ${formatBRL(otherCents)}`;
  const from = installmentFirstMonth.value;
  return /^\d{4}-\d{2}$/.test(from)
    ? `${values} · de ${shortMonth(from)} a ${shortMonth(lastInstallmentMonth({ count: n, firstMonth: from }))}`
    : values;
});

/** Resumo travado da série na edição. */
const seriesSummary = computed(() => {
  const e = editing;
  if (!e?.installment) return '';
  return `Parcela ${e.installment.index}/${e.installment.count} · ${formatBRL(e.totalCents)} · total da compra ${formatBRL(e.installment.purchaseCents)}`;
});

// ---- Validação ----
const errors = computed(() => {
  const e: Partial<Record<'total' | 'description' | 'date' | 'personal' | 'firstMonth', string>> = {};
  if (totalCents.value <= 0) e.total = 'Informe o valor.';
  if (description.value.trim() === '') e.description = 'Informe a descrição.';
  if (!isIsoDate(date.value)) e.date = 'Informe a data.';
  else if (date.value < minDate.value || date.value > maxDate.value) e.date = 'Data fora do período permitido.';
  if (personalCents.value > totalCents.value) e.personal = 'Não pode ser maior que o total.';
  if (installmentOn.value) {
    const m = installmentFirstMonth.value;
    if (!/^\d{4}-\d{2}$/.test(m)) e.firstMonth = 'Informe o mês da primeira.';
    else if (m < firstMonthBounds.value.min || m > firstMonthBounds.value.max) e.firstMonth = 'Mês fora do período permitido.';
    else if (closedMonths.value.has(m)) e.firstMonth = 'Este mês está fechado.';
    if (totalCents.value > 0 && totalCents.value < installmentCount.value) e.total = 'Valor menor que o número de parcelas.';
  }
  return e;
});

// ---- Ações ----
function save(): void {
  showErrors.value = true;
  if (Object.keys(errors.value).length > 0 || !group.value || !competence.value) return;

  const input = {
    description: description.value,
    note: note.value,
    totalCents: totalCents.value,
    personalCents: personalCents.value,
    payerUid: payerUid.value,
    payerSharePct: payerSharePct.value,
    date: date.value,
    receipt: receiptChoice(),
  };
  // Foto nova: de recibo, ou da nota junto com a chave.
  const photo =
    receipt.value.type === 'photo' ? receipt.value.data : receipt.value.type === 'nfce' ? receipt.value.photo?.data : undefined;
  // Não espera o servidor: offline, a gravação (e a foto) sincronizam depois.
  if (editing?.installment) {
    const targets = seriesParcels.value.length > 0 ? seriesTargets(seriesParcels.value, 'edit', myUid.value, closedMonths.value) : [editing];
    updateSeries(group.value.id, editing.installment.seriesId, targets, input, photo);
    router.replace({ name: 'gasto', params: { id: editing.id } });
    return;
  }
  if (!editing && installmentOn.value) {
    const result = createInstallmentSeries(
      group.value.id,
      input,
      { count: installmentCount.value, firstMonth: installmentFirstMonth.value },
      myUid.value,
      photo,
    );
    router.replace({ name: 'painel', query: { mes: result.competence } });
    return;
  }
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
  if (r.type === 'nfce') {
    return { type: 'nfce', nfceKey: r.nfceKey, entry: r.entry, ...(r.photo ? { photo: { replaced: r.photo.data !== undefined } } : {}) };
  }
  return { type: 'none' };
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'painel' });
}
</script>

<style scoped>
.series-summary,
.installments {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.series-summary p {
  margin: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.check input {
  width: 20px;
  height: 20px;
}

textarea.note {
  height: auto;
  min-height: 64px;
  padding-top: 10px;
  padding-bottom: 10px;
  resize: vertical;
  font: inherit;
}

.counter {
  text-align: right;
}

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
