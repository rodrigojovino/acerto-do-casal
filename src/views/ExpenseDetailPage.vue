<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
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
            <span class="badge-row">
              <StatusBadge v-bind="badgeFor(expense, myUid, true)" />
              <TypeBadge v-for="t in typeBadges(expense)" :key="t" :label="t" />
              <span v-if="origin" class="origin">{{ origin }}</span>
            </span>
            <span v-if="statusText" class="hint">{{ statusText }}</span>
            <h2>{{ expense.description }}</h2>
            <p class="value num">
              {{ expense.status === 'awaiting_confirmation' ? 'Valor a confirmar' : formatBRL(expense.installment ? purchaseCents : expense.totalCents) }}
            </p>
            <p v-if="expense.installment" class="parcel-line">{{ parcelLine }}</p>
            <p class="hint big">Pago por {{ payerLabel }} · {{ formatDateBR(expense.date) }}</p>
          </section>

          <div v-if="expense.installment" class="card series">
            <p class="strong">Compra parcelada</p>
            <p class="hint">{{ seriesPeriod }}</p>
          </div>

          <div v-if="expense.status === 'returned' && expense.rejection" class="rejection" role="status">
            <p class="strong">
              {{ expense.rejection.kind === 'contest' ? 'Contestado' : 'Recusado' }} por {{ nameLower(expense.rejection.byUid) }}
            </p>
            <p>{{ expense.rejection.reason ? `"${expense.rejection.reason}"` : 'Sem motivo informado.' }}</p>
          </div>

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

          <section v-if="expense.note" class="card note" aria-labelledby="obs-titulo">
            <p id="obs-titulo" class="strong">Observação</p>
            <p class="note-text">{{ expense.note }}</p>
          </section>

          <p v-if="competenceNote" class="hint">{{ competenceNote }}</p>

          <!-- Comprovante -->
          <button
            v-if="photoUrl"
            type="button"
            class="photo-btn"
            aria-label="Ampliar foto do comprovante"
            @click="zoomOpen = true"
          >
            <img :src="photoUrl" alt="Foto do comprovante" class="photo" />
            <span v-if="photoQueuedHere" class="photo-badge">Foto pendente de envio</span>
          </button>
          <div v-if="expense.receipt.type !== 'photo' || !photoUrl" class="receipt">
            <p class="strong">{{ receiptTitle }}</p>
            <p v-if="receiptDetail" class="hint">{{ receiptDetail }}</p>
            <button v-if="canRetryNfce" type="button" class="link" @click="retryNfce">Tentar conferir de novo</button>
            <button v-if="noteItems" type="button" class="btn outline items-btn" @click="itemsOpen = true">
              Ver itens da nota ({{ noteItems.items.length }})
            </button>
          </div>

          <p class="hint">
            Lançado por {{ creatorLabel }}{{ createdText }}.<br />
            <template v-if="expense.pendingWrite">Ainda não sincronizado: será enviado quando houver conexão.<br /></template>
            <template v-if="approvalText">{{ approvalText }}<br /></template>
            <template v-if="expense.status === 'awaiting_confirmation'">Ainda não conta no saldo: falta confirmar o valor deste mês.</template>
            <template v-else>Já conta no saldo do mês{{ expense.status === 'confirmed' ? '' : ', destacado como pendente' }}.</template>
          </p>

          <div class="actions">
            <p v-if="isClosed" class="hint">Mês fechado: este gasto não pode mais ser alterado.</p>

            <!-- Outro membro: aprovar ou recusar um pendente -->
            <template v-else-if="canReview">
              <label for="motivo" class="label">Motivo, se for recusar (opcional)</label>
              <input id="motivo" v-model="reason" class="input" maxlength="200" placeholder="Ex.: anexe a nota, por favor" />
              <div class="grid-2">
                <button class="btn outline" :class="{ stacked: expense.installment }" type="button" @click="reject">
                  <span>{{ actionVerb('Recusar') }}</span>
                  <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
                </button>
                <button class="btn primary" :class="{ stacked: expense.installment }" type="button" @click="approve">
                  <span>{{ actionVerb('Aprovar') }}</span>
                  <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
                </button>
              </div>
              <p v-if="seriesNote('approve')" class="hint">{{ seriesNote('approve') }}</p>
            </template>

            <!-- Outro membro: validar ou contestar um confirmado automaticamente -->
            <template v-else-if="contestable">
              <button class="btn primary" :class="{ stacked: expense.installment }" type="button" @click="validate">
                <span>{{ actionVerb('Validar') }}</span>
                <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
              </button>
              <p class="hint">Validar confirma que está tudo certo: o gasto não poderá mais ser contestado.</p>
              <label for="contestacao" class="label">Ou conteste, com o motivo</label>
              <input
                id="contestacao"
                v-model="reason"
                class="input"
                maxlength="200"
                placeholder="Ex.: o valor não bate com a nota"
                :aria-invalid="contestTried && !reason.trim()"
              />
              <p v-if="contestTried && !reason.trim()" class="field-error">Informe o motivo para contestar.</p>
              <button class="btn outline" :class="{ stacked: expense.installment }" type="button" @click="contest">
                <span>{{ actionVerb('Contestar') }}</span>
                <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
              </button>
              <p class="hint">O gasto volta para {{ creatorLabel }} corrigir ou excluir; a correção passa pela sua aprovação.</p>
              <p v-if="seriesNote('contest')" class="hint">{{ seriesNote('contest') }}</p>
            </template>

            <!-- Recorrente variável: quem paga confirma o valor -->
            <template v-else-if="isCreator && expense.status === 'awaiting_confirmation'">
              <router-link class="btn primary" :to="{ name: 'gasto-editar', params: { id: expense.id } }">Confirmar valor</router-link>
              <p class="hint">Sem comprovante, vai para a aprovação de {{ partnerFirstName }}; com foto ou QR, já entra confirmado.</p>
            </template>

            <!-- Quem lançou -->
            <template v-else-if="isCreator">
              <router-link
                v-if="expense.status === 'pending_approval' && expense.receipt.type === 'none'"
                class="btn outline attach"
                :to="{ name: 'gasto-editar', params: { id: expense.id } }"
              >
                Anexar comprovante e dispensar aprovação
              </router-link>
              <div class="grid-2">
                <button class="btn danger" type="button" @click="confirmDelete">Excluir</button>
                <router-link class="btn primary" :to="{ name: 'gasto-editar', params: { id: expense.id } }">
                  {{ expense.status === 'returned' ? 'Corrigir' : expense.installment ? 'Editar série' : 'Editar' }}
                </router-link>
              </div>
              <p v-if="expense.installment" class="hint">Editar e excluir valem para todas as parcelas de meses abertos.</p>
              <p v-if="expense.status === 'confirmed'" class="hint">
                Editar este gasto faz ele voltar para a aprovação de {{ partnerFirstName }}.
              </p>
              <p v-else-if="expense.status === 'returned'" class="hint">A correção vai para a aprovação de {{ partnerFirstName }}.</p>
            </template>
          </div>
        </template>
      </main>

      <!-- Itens da NFC-e de SP conferida (do cache: abre offline) -->
      <ion-modal :is-open="itemsOpen && !!noteItems" @did-dismiss="itemsOpen = false">
        <NfceItemsSheet
          v-if="noteItems"
          :items="noteItems"
          :issuer="expense?.receipt.type === 'nfce' ? expense.receipt.nfceData?.issuerName : undefined"
          @close="itemsOpen = false"
        />
      </ion-modal>

      <!-- Foto ampliada: toque para aproximar e afastar -->
      <ion-modal :is-open="zoomOpen" @did-dismiss="zoomOpen = false">
        <div class="zoom">
          <div class="zoom-head">
            <span class="strong">Comprovante</span>
            <button class="icon-btn light" type="button" aria-label="Fechar" @click="zoomOpen = false">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div class="zoom-body">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Foto do comprovante ampliada"
              :class="{ big: zoomed }"
              @click="zoomed = !zoomed"
            />
          </div>
          <p class="zoom-hint">Toque na foto para {{ zoomed ? 'afastar' : 'aproximar' }}</p>
        </div>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonModal, IonPage, alertController } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatDateBR, monthName, monthOf } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import { splitForViewer } from '@/domain/split';
import {
  approveExpense,
  contestExpense,
  deleteExpense,
  receiptPhotoUrl,
  rejectExpense,
  retryNfceCheck,
  deleteSeries,
  validateExpense,
  watchExpense,
  watchSeries,
  type Expense,
} from '@/services/expenses';
import { seriesTargets, type SeriesAction } from '@/services/series';
import { installmentSummary } from '@/domain/installments';
import { NFCE_APPROVER, badgeFor, canContest, debtView, isAutoConfirmed, originLabel, tagFor, typeBadges } from '@/services/expenseView';
import TypeBadge from '@/components/TypeBadge.vue';
import NfceItemsSheet from '@/components/NfceItemsSheet.vue';
import { nfceItemsByKey } from '@/services/nfceItems';
import StatusBadge from '@/components/StatusBadge.vue';
import { closedMonths } from '@/services/months';
import { formatCnpj } from '@/services/nfce';
import { UF_BY_CODE, parseAccessKey } from '../../functions/src/nfce';
import { pendingPhotoIds } from '@/services/photoQueue';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

const myUid = computed(() => user.value?.uid ?? '');
const members = computed<Members>(() => [myUid.value, partnerUid.value ?? ''] as const);

// Fixado na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const expenseId = String(route.params.id);

// ---- Gasto em tempo real (inclusive do cache offline) ----
const expense = ref<Expense | null>(null);
const loaded = ref(false);
const loadError = ref<string | null>(null);
let stop: (() => void) | null = null;

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

// ---- Compra parcelada: a série inteira em tempo real ----
const seriesParcels = ref<Expense[]>([]);
let stopSeries: (() => void) | null = null;
watch(
  () => [group.value?.id, expense.value?.installment?.seriesId] as const,
  ([groupId, seriesId]) => {
    stopSeries?.();
    stopSeries = null;
    seriesParcels.value = [];
    if (groupId && seriesId) {
      stopSeries = watchSeries(groupId, seriesId, (list) => (seriesParcels.value = list), () => undefined);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => stopSeries?.());

/** Gastos que a ação atinge: a série inteira (meses abertos) ou só este gasto. */
function targetsFor(action: SeriesAction): Expense[] {
  const e = expense.value;
  if (!e) return [];
  if (!e.installment) return [e];
  const parcels = seriesParcels.value.length > 0 ? seriesParcels.value : [e];
  return seriesTargets(parcels, action, myUid.value, closedMonths.value);
}

function seriesNote(action: SeriesAction): string | null {
  if (!expense.value?.installment) return null;
  const n = targetsFor(action).length;
  return n > 1 ? `Vale para a compra inteira: ${n} parcelas de meses abertos.` : null;
}

/** Valor da compra inteira (gravado em cada parcela). */
const purchaseCents = computed(() => expense.value?.installment?.purchaseCents ?? expense.value?.totalCents ?? 0);

const shortMonth = (m: string) => `${monthName(m).slice(0, 3)}/${m.slice(0, 4)}`;

/** "48x de R$ 100,00 · esta é a parcela 1 (out/2026)". */
const parcelLine = computed(() => {
  const e = expense.value;
  const i = e?.installment;
  if (!e || !i) return '';
  const { values } = installmentSummary(i, formatBRL);
  return `${values} · esta é a parcela ${i.index} (${shortMonth(e.competence)})`;
});

/** "de out/2026 a set/2030". */
const seriesPeriod = computed(() => {
  const i = expense.value?.installment;
  if (!i) return '';
  const { firstMonth, lastMonth } = installmentSummary(i, formatBRL);
  return `de ${shortMonth(firstMonth)} a ${shortMonth(lastMonth)}`;
});

/** Numa série, o botão diz o que está sendo decidido: "Aprovar compra" (com o total na linha de baixo). */
function actionVerb(verb: string): string {
  return expense.value?.installment ? `${verb} compra` : verb;
}

// ---- Foto ----
const photoUrl = ref<string | null>(null);
const zoomOpen = ref(false);
const zoomed = ref(false);
const photoQueuedHere = computed(() => pendingPhotoIds.value.has(expense.value?.installment?.seriesId ?? expenseId));

watch(
  () => [expense.value?.receipt, photoQueuedHere.value] as const,
  async () => {
    const e = expense.value;
    photoUrl.value = e && group.value ? await receiptPhotoUrl(group.value.id, e) : null;
  },
  { immediate: true },
);

// ---- Textos e cálculo: funções de src/domain via expenseView ----
const isCreator = computed(() => expense.value?.createdBy === myUid.value);
const isClosed = computed(() => !!expense.value && closedMonths.value.has(expense.value.competence));
const canReview = computed(() => !!expense.value && !isCreator.value && expense.value.status === 'pending_approval');
const contestable = computed(() => !!expense.value && canContest(expense.value, myUid.value));

const nameLower = (uid: string) => firstNameOf(uid).replace('Você', 'você');
const payerLabel = computed(() => (expense.value ? nameLower(expense.value.payerUid) : ''));
const creatorLabel = computed(() => (expense.value ? nameLower(expense.value.createdBy) : ''));

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Frase de apoio ao selo (quem precisa agir). */
const statusText = computed(() => {
  const e = expense.value;
  if (!e) return '';
  if (e.status === 'awaiting_confirmation') {
    return isCreator.value ? 'Confirme o valor deste mês.' : `Aguarda ${partnerFirstName.value} confirmar o valor.`;
  }
  switch (tagFor(e, myUid.value)) {
    case 'pending':
      return `Aguarda aprovação de ${partnerFirstName.value}.`;
    case 'approve':
      return 'Aguarda sua aprovação.';
    case 'returned':
      return isCreator.value ? 'Corrija ou exclua; a correção vai para aprovação.' : `Aguarda ${partnerFirstName.value} corrigir.`;
    default:
      return '';
  }
});

/** "Validado por Bia", "Automático · nota conferida", "Automático · foto"… */
const origin = computed(() => (expense.value ? originLabel(expense.value, (uid) => nameLower(uid)) : null));

const approvalText = computed(() => {
  const e = expense.value;
  if (!e || e.status !== 'confirmed') return null;
  if (isAutoConfirmed(e)) {
    const who = isCreator.value ? partnerFirstName.value : 'Você';
    return `${who} pode validar ou contestar até o fechamento do mês.`;
  }
  const a = e.approval;
  return a?.at && a.byUid !== NFCE_APPROVER ? `Validado em ${dateTime.format(a.at).replace(', ', ' às ')}.` : null;
});

/** Comprovante sem foto exibível: sem comprovante, foto não enviada ou nota. */
const receiptTitle = computed(() => {
  const r = expense.value?.receipt;
  if (!r || r.type === 'none') return 'Nenhum comprovante anexado';
  if (r.type === 'photo') return isCreator.value ? 'Foto pendente de envio' : 'Foto ainda não enviada';
  if (r.nfceStatus === 'unchecked') {
    return r.nfceKey.slice(20, 22) === '55'
      ? `NF-e de ${nfceUf.value}: sem conferência automática`
      : `NFC-e de ${nfceUf.value}: conferência automática só para SP`;
  }
  if (r.nfceStatus === 'pending') return 'NFC-e: consultando a SEFAZ…';
  if (r.nfceStatus === 'failed') return 'NFC-e: não foi possível conferir';
  if (r.nfceData && expense.value && r.nfceData.totalCents !== purchaseCents.value) {
    return `Valor diferente da nota: ${formatBRL(r.nfceData.totalCents)}`;
  }
  return 'NFC-e conferida pela SEFAZ';
});

const receiptDetail = computed(() => {
  const e = expense.value;
  const r = e?.receipt;
  if (!e || !r) return null;
  if (r.type === 'none') {
    if (e.status === 'confirmed') return null;
    return isCreator.value
      ? `Por isso este gasto precisa da aprovação de ${partnerFirstName.value}.`
      : 'Por isso este gasto precisa da sua aprovação.';
  }
  if (r.type === 'photo') {
    return isCreator.value
      ? 'A foto está guardada no seu aparelho e sobe quando houver conexão.'
      : `${partnerFirstName.value} já anexou a foto; ela aparece aqui assim que for enviada.`;
  }
  const parts: string[] = [];
  if (r.nfceStatus === 'unchecked') {
    const access = parseAccessKey(r.nfceKey);
    const [y, m] = access.yearMonth.split('-');
    parts.push(`CNPJ ${formatCnpj(access.cnpj)} · emitida em ${m}/${y}.`);
    parts.push(
      access.model === '55'
        ? 'A chave vale como comprovante; a consulta de NF-e exige captcha, então o valor é o digitado.'
        : 'A chave vale como comprovante.',
    );
  }
  if (r.nfceData) parts.push(`${r.nfceData.issuerName} · ${formatDateBR(r.nfceData.date)} · ${formatBRL(r.nfceData.totalCents)}`);
  if (r.nfceStatus === 'pending') parts.push('A conferência acontece no servidor, também para notas lidas sem conexão.');
  if (r.nfceStatus === 'failed') parts.push('A chave continua valendo como comprovante.');
  if (r.photoPath && !r.photoUploaded) {
    parts.push(isCreator.value ? 'A foto da nota sobe quando houver conexão.' : 'A foto da nota aparece aqui assim que for enviada.');
  }
  if (r.nfceStatus === 'ok' && r.nfceData && r.nfceData.totalCents !== purchaseCents.value) {
    parts.push(`O valor lançado (${formatBRL(purchaseCents.value)}) não bate com a nota.`);
  }
  return parts.join(' ') || null;
});

// ---- Itens da nota: só NFC-e de SP conferida, com os itens lidos ----
const itemsOpen = ref(false);
const noteItems = computed(() => {
  const r = expense.value?.receipt;
  if (r?.type !== 'nfce' || !r.nfceUrl || r.nfceStatus !== 'ok') return null;
  return nfceItemsByKey.value.get(r.nfceKey) ?? null;
});

const canRetryNfce = computed(
  () =>
    isCreator.value &&
    expense.value?.receipt.type === 'nfce' &&
    expense.value.receipt.nfceStatus === 'failed' &&
    !isClosed.value,
);

/** UF da nota (pela chave), para o aviso de notas de fora de SP. */
const nfceUf = computed(() => {
  const r = expense.value?.receipt;
  return r?.type === 'nfce' ? (UF_BY_CODE[r.nfceKey.slice(0, 2)] ?? r.nfceKey.slice(0, 2)) : '';
});

const sharedCents = computed(() => (expense.value ? expense.value.totalCents - expense.value.personalCents : 0));

const split = computed(() =>
  expense.value
    ? splitForViewer(expense.value.payerSharePct, expense.value.payerUid, myUid.value)
    : { mine: 50, partner: 50 },
);

const debt = computed(() =>
  expense.value && partnerUid.value
    ? debtView(expense.value, members.value, myUid.value, firstNameOf, expense.value.installment ? 'esta parcela' : 'este gasto')
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

const createdText = computed(() => {
  const at = expense.value?.createdAt;
  return at ? ` em ${dateTime.format(at).replace(', ', ' às ')}` : '';
});

// ---- Ações (não esperam o servidor: funcionam offline) ----
const reason = ref('');

const idsFor = (action: SeriesAction) => targetsFor(action).map((p) => p.id);

function approve(): void {
  if (!group.value || !expense.value) return;
  approveExpense(group.value.id, idsFor('approve'), myUid.value);
}

function validate(): void {
  if (!group.value || !expense.value) return;
  validateExpense(group.value.id, idsFor('validate'), myUid.value);
}

const contestTried = ref(false);

function contest(): void {
  contestTried.value = true;
  if (!group.value || !expense.value || !reason.value.trim()) return;
  contestExpense(group.value.id, idsFor('contest'), myUid.value, reason.value);
  reason.value = '';
  contestTried.value = false;
}

function reject(): void {
  if (!group.value || !expense.value) return;
  rejectExpense(group.value.id, idsFor('reject'), myUid.value, reason.value);
  reason.value = '';
}

function retryNfce(): void {
  if (group.value && expense.value) retryNfceCheck(group.value.id, expense.value);
}

async function confirmDelete(): Promise<void> {
  const e = expense.value;
  if (!e || !group.value) return;
  if (e.installment) return confirmDeleteSeries(e);
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
  await deleteExpense(group.value.id, e);
  router.replace({ name: 'painel', query: { mes: e.competence } });
}

async function confirmDeleteSeries(e: Expense): Promise<void> {
  if (!group.value || !e.installment) return;
  const targets = targetsFor('delete');
  const kept = e.installment.count - targets.length;
  const alert = await alertController.create({
    header: 'Excluir a compra parcelada?',
    message:
      `"${e.description}": ${targets.length} ${targets.length === 1 ? 'parcela sai' : 'parcelas saem'} do saldo.` +
      (kept > 0 ? ` ${kept} de meses fechados ${kept === 1 ? 'fica' : 'ficam'}.` : ''),
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Excluir', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  await deleteSeries(group.value.id, e.installment.seriesId, targets);
  router.replace({ name: 'painel', query: { mes: e.competence } });
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'painel', query: expense.value ? { mes: expense.value.competence } : {} });
}
</script>

<style scoped>
.parcel-line {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--app-accent-dark);
}

.btn.stacked {
  flex-direction: column;
  gap: 0;
  height: auto;
  min-height: 52px;
  padding-top: 6px;
  padding-bottom: 6px;
  line-height: 1.2;
}

.btn.stacked .num {
  white-space: nowrap;
}

.note {
  padding: 12px 16px;
}

.note p {
  margin: 0 0 2px;
}

.note-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.items-btn {
  margin-top: 8px;
  height: 44px;
  width: 100%;
}

.series {
  padding: 12px 16px;
}

.series p {
  margin: 0 0 2px;
}

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

.badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.badge-row :deep(.badge) {
  font-size: 12px;
  padding: 3px 10px 3px 8px;
}

.origin {
  font-size: 12px;
  font-weight: 700;
  color: var(--app-muted);
}

.rejection {
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  background: var(--app-danger-bg);
  color: var(--app-danger);
  font-size: 14px;
}

.rejection p {
  margin: 0;
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

.photo-btn {
  position: relative;
  padding: 0;
  border: 1px solid var(--app-border);
  border-radius: 16px;
  overflow: hidden;
  background: var(--app-subtle);
  cursor: zoom-in;
}

.photo {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: cover;
}

.photo-badge {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #fcebd9;
  color: #8a3f00;
  font-size: 12px;
  font-weight: 700;
}

.actions {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attach {
  font-size: 14px;
}

.zoom {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #111;
  color: #fff;
  padding-top: var(--app-safe-top);
  padding-bottom: var(--app-safe-bottom);
}

.zoom-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 16px;
}

.icon-btn.light {
  color: #fff;
}

.zoom-body {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-body img {
  max-width: 100%;
  max-height: 100%;
  cursor: zoom-in;
}

.zoom-body img.big {
  max-width: none;
  max-height: none;
  width: 250%;
  cursor: zoom-out;
}

.zoom-hint {
  margin: 0;
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: #c9c8c2;
}
</style>
