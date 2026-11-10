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
            <p class="hint big">Categoria: {{ categoryName }}</p>
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
            <template v-if="canRetryNfce">
              <button type="button" class="link" :disabled="retryBusy || retryLocked" @click="retryNfce">
                {{ retryBusy ? 'Consultando a nota…' : 'Tentar conferir de novo' }}
              </button>
              <p v-if="retryLocked" class="hint">Tente de novo mais tarde (a partir das {{ retryTime }}).</p>
            </template>
            <p v-if="retryMessage" class="hint" role="status">{{ retryMessage }}</p>
            <div v-if="itemsNotSaved" class="items-alert" role="alert">
              <p>Os itens lidos da nota não foram gravados ({{ itemsNotSaved.items.items.length }}). Gravar de novo usa a leitura guardada, sem consultar a SEFAZ.</p>
              <button type="button" class="link" @click="saveItemsAgain(itemsNotSaved)">Tentar gravar de novo</button>
            </div>
            <button v-if="spUrl" type="button" class="link" @click="openNotaInBrowser(spUrl)">Ver a nota na SEFAZ</button>
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

            <!-- Outro membro: pedido de exclusão aberto (só aprova ou recusa o pedido) -->
            <template v-else-if="openRequest && !isCreator">
              <p class="strong">{{ firstNameOf(expense.createdBy) }} pediu para excluir {{ expense.installment ? 'esta compra' : 'este gasto' }}.</p>
              <p v-if="expense.deletionRequest?.reason" class="hint">Motivo: “{{ expense.deletionRequest.reason }}”</p>
              <div class="grid-2">
                <button class="btn outline" :class="{ stacked: expense.installment }" type="button" @click="denyDel">
                  <span>{{ actionVerb('Recusar') }}</span>
                  <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
                </button>
                <button class="btn danger" :class="{ stacked: expense.installment }" type="button" @click="approveDel">
                  <span>{{ expense.installment ? 'Excluir compra' : 'Aprovar exclusão' }}</span>
                  <span v-if="expense.installment" class="num">{{ formatBRL(purchaseCents) }}</span>
                </button>
              </div>
              <p class="hint">Aprovado, o gasto sai do saldo; recusado, continua como está.</p>
              <p v-if="seriesNote('answerDeletion')" class="hint">{{ seriesNote('answerDeletion') }}</p>
            </template>

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
              <p class="hint">
                Sem comprovante ou com divisão diferente de 50/50, vai para a aprovação de {{ partnerFirstName }}; com foto ou nota e
                50/50, já entra confirmado.
              </p>
            </template>

            <!-- Quem lançou -->
            <template v-else-if="isCreator">
              <router-link
                v-if="expense.status === 'pending_approval' && expense.receipt.type === 'none' && expense.payerSharePct === 50"
                class="btn outline attach"
                :to="{ name: 'gasto-editar', params: { id: expense.id } }"
              >
                Anexar comprovante e dispensar aprovação
              </router-link>
              <!-- Pedido de exclusão aberto: aguarda o outro; quem pediu pode cancelar -->
              <template v-if="openRequest">
                <p class="strong">Exclusão pedida: aguarda {{ partnerFirstName }}.</p>
                <p v-if="expense.deletionRequest?.reason" class="hint">Motivo: “{{ expense.deletionRequest.reason }}”</p>
              </template>
              <p v-else-if="deniedText" class="hint">{{ deniedText }}</p>
              <div class="grid-2">
                <button v-if="openRequest" class="btn outline" type="button" @click="cancelDel">Cancelar pedido</button>
                <button v-else-if="canDirectDelete" class="btn danger" type="button" @click="confirmDelete">Excluir</button>
                <button v-else class="btn danger" type="button" @click="askDeletion">Pedir exclusão</button>
                <router-link class="btn primary" :to="{ name: 'gasto-editar', params: { id: expense.id } }">
                  {{ expense.status === 'returned' ? 'Corrigir' : expense.installment ? 'Editar série' : 'Editar' }}
                </router-link>
              </div>
              <p v-if="openRequest" class="hint">Editar cancela o pedido; o gasto volta para a aprovação de {{ partnerFirstName }}.</p>
              <p v-else-if="!canDirectDelete" class="hint">
                Este gasto já foi confirmado: para excluir, {{ partnerFirstName }} precisa aprovar. Até lá, continua no saldo.
              </p>
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
          :issuer="expense?.receipt.type === 'nfce' ? (expense.receipt.nfceData?.issuerName ?? noteItems.issuerName) : undefined"
          :device="isDeviceItems(noteItems)"
          :marks="noteMarks.marks"
          :marks-warning="noteMarks.warning"
          :partner-name="partnerFirstName"
          :initials="initials"
          @close="itemsOpen = false"
        />
      </ion-modal>

      <!-- Foto ampliada, com pinça, toque duplo e arraste até as bordas -->
      <PhotoViewer :url="zoomOpen ? photoUrl : null" title="Comprovante" alt="Foto do comprovante ampliada" @close="zoomOpen = false" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonModal, IonPage, alertController } from '@ionic/vue';
import { categoryLabel } from '@/domain/categories';
import { categories } from '@/services/categories';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatDateBR, monthName, monthOf } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import { splitForViewer } from '@/domain/split';
import {
  approveDeletion,
  approveExpense,
  cancelDeletion,
  contestExpense,
  denyDeletion,
  requestDeletion,
  deleteExpense,
  receiptPhotoUrl,
  rejectExpense,
  deleteSeries,
  validateExpense,
  watchExpense,
  watchSeries,
  type Expense,
} from '@/services/expenses';
import { seriesTargets, type SeriesAction } from '@/services/series';
import { installmentSummary } from '@/domain/installments';
import { MAX_DELETION_REASON, directlyDeletable } from '@/services/expenseData';
import { NFCE_APPROVER, badgeFor, canContest, debtView, isAutoConfirmed, originLabel, tagFor, typeBadges } from '@/services/expenseView';
import TypeBadge from '@/components/TypeBadge.vue';
import PhotoViewer from '@/components/PhotoViewer.vue';
import NfceItemsSheet from '@/components/NfceItemsSheet.vue';
import { isDeviceItems, nfceItemsByKey, watchNfceRetry } from '@/services/nfceItems';
import { rejectedItems, saveItemsAgain, saveItemsAlone } from '@/services/itemsGuard';
import { canWriteDeviceItems } from '@/services/nfceItemsData';
import { notaWebViewAvailable, openNotaInBrowser } from '@/services/notaWebView';
import { NFCE_BUDGET_MS } from '@/domain/nfceFlow';
import StatusBadge from '@/components/StatusBadge.vue';
import { closedMonths } from '@/services/months';
import { formatCnpj, readNfceOnDevice, retryNfceOnServer } from '@/services/nfce';
import { UF_BY_CODE, parseAccessKey } from '../../functions/src/nfce';
import { pendingPhotoIds } from '@/services/photoQueue';
import { firstNameOf, group, memberFirstName, partnerFirstName, partnerUid, user } from '@/services/session';
import { coupleInitials, marksMatch, readMarks, type ViewerMark } from '@/domain/itemMarks';

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
/** Pedido de exclusão aberto: o outro só aprova ou recusa o pedido (nada de aprovar, validar ou contestar). */
const openRequest = computed(() => expense.value?.deletionRequest?.status === 'pending');
const canReview = computed(
  () => !!expense.value && !openRequest.value && !isCreator.value && expense.value.status === 'pending_approval',
);
const contestable = computed(() => !!expense.value && !openRequest.value && canContest(expense.value, myUid.value));
/** Pendente ou "a confirmar" nunca confirmado, ou devolvido: sai direto; os demais, pelo pedido. */
const canDirectDelete = computed(() => !!expense.value && directlyDeletable(expense.value));

/** "Bia recusou excluir em 22/10 às 14:30." */
const deniedText = computed(() => {
  const r = expense.value?.deletionRequest;
  if (r?.status !== 'denied' || !r.answeredBy) return null;
  const when = r.answeredAt ? ` em ${dateTime.format(r.answeredAt).replace(', ', ' às ')}` : '';
  return `${firstNameOf(r.answeredBy)} recusou excluir${when}. Você pode pedir de novo.`;
});

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
  if (openRequest.value) {
    return isCreator.value ? `Exclusão pedida: aguarda ${partnerFirstName.value}.` : 'Exclusão pedida: aguarda sua resposta.';
  }
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
  if (r.nfceStatus === 'unchecked' && r.nfceUrl) {
    return deviceItems.value ? 'NFC-e lida no aparelho, sem conferência da SEFAZ' : 'NFC-e de SP: a SEFAZ não liberou a consulta';
  }
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
  if (r.nfceStatus === 'unchecked' && r.nfceUrl) {
    const d = deviceItems.value;
    if (d?.issuerName && d.date) parts.push(`${d.issuerName} · ${formatDateBR(d.date)} · ${formatBRL(d.totalCents)}.`);
    parts.push('A chave vale como comprovante.');
  } else if (r.nfceStatus === 'unchecked') {
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
const categoryName = computed(() => categoryLabel(expense.value?.categoryId, categories.value));

const noteItems = computed(() => {
  const r = expense.value?.receipt;
  if (r?.type !== 'nfce' || !r.nfceUrl) return null;
  const items = nfceItemsByKey.value.get(r.nfceKey) ?? null;
  // Conferida: os itens oficiais. Sem conferência: os lidos no aparelho, se houver.
  return r.nfceStatus === 'ok' || isDeviceItems(items) ? items : null;
});

/** Itens lidos no aparelho desta nota que o servidor não tem (recusados ou perdidos): aviso com "Tentar gravar de novo". */
const itemsNotSaved = computed(() => {
  const r = expense.value?.receipt;
  if (r?.type !== 'nfce' || nfceItemsByKey.value.has(r.nfceKey)) return null;
  return rejectedItems.value.find((x) => x.groupId === group.value?.id && x.key === r.nfceKey) ?? null;
});

/** Iniciais do casal (a mesma pessoa tem a mesma inicial para quem vê). */
const initials = computed(() => {
  const [mine, partner] = coupleInitials(memberFirstName(myUid.value), memberFirstName(partnerUid.value));
  return { mine, partner };
});

/**
 * Marcações dos itens (v0.9.2), relativas a quem vê: as do gasto ou, numa
 * série, as da parcela 1. Se os itens gravados mudaram (os oficiais
 * substituíram os lidos no aparelho), não mostra as marcações e avisa.
 */
const noteMarks = computed<{ marks: ViewerMark[] | null; warning: string | null }>(() => {
  const e = expense.value;
  const items = noteItems.value;
  if (!e || !items) return { marks: null, warning: null };
  const first = e.installment ? seriesParcels.value.find((p) => p.installment?.index === 1) : e;
  const stored = first?.itemMarks ?? e.itemMarks;
  if (!stored) return { marks: null, warning: null };
  if (!marksMatch(stored, items)) {
    return { marks: null, warning: 'As marcações dos itens foram feitas em itens que não correspondem a estes (a nota foi atualizada). Os valores "só meu / só de" do gasto continuam como foram lançados.' };
  }
  return { marks: readMarks(stored.m, myUid.value, e.payerUid), warning: null };
});

/** Itens lidos no aparelho (sem conferência da SEFAZ), para o título e o detalhe. */
const deviceItems = computed(() => (noteItems.value && isDeviceItems(noteItems.value) ? noteItems.value : null));

/** URL oficial da NFC-e de SP ("Ver a nota na SEFAZ"). */
const spUrl = computed(() => (expense.value?.receipt.type === 'nfce' ? (expense.value.receipt.nfceUrl ?? null) : null));

// ---- "Tentar conferir de novo": uma tentativa pelo servidor a cada minuto por nota ----
const canRetryNfce = computed(
  () =>
    isCreator.value &&
    !!spUrl.value &&
    expense.value?.receipt.type === 'nfce' &&
    (expense.value.receipt.nfceStatus === 'failed' || expense.value.receipt.nfceStatus === 'unchecked') &&
    !isClosed.value,
);
const retryBusy = ref(false);
const retryMessage = ref<string | null>(null);
/** Quando a próxima tentativa fica liberada (do servidor: vale para os dois aparelhos). */
const retryAt = ref(0);
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 20_000);
const retryLocked = computed(() => retryAt.value > now.value);
const retryTime = computed(() => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(retryAt.value));
let stopRetry: (() => void) | null = null;
watch(
  () => (group.value && expense.value?.receipt.type === 'nfce' ? `${group.value.id}/${expense.value.receipt.nfceKey}` : null),
  (path) => {
    stopRetry?.();
    stopRetry = null;
    retryAt.value = 0;
    if (!path) return;
    const [groupId, key] = path.split('/');
    stopRetry = watchNfceRetry(groupId, key, (at) => (retryAt.value = at));
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  stopRetry?.();
  clearInterval(clock);
});

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

// ---- Pedido de exclusão ----

/** Quem lançou: pede a exclusão (numa série, as parcelas de meses abertos), motivo opcional. */
async function askDeletion(): Promise<void> {
  const e = expense.value;
  if (!e || !group.value) return;
  const alert = await alertController.create({
    header: e.installment ? 'Pedir exclusão da compra?' : 'Pedir exclusão?',
    message: `${partnerFirstName.value} precisa aprovar a exclusão de "${e.description}". Até lá, o gasto continua no saldo.`,
    inputs: [{ name: 'reason', type: 'textarea', placeholder: 'Motivo (opcional)', attributes: { maxlength: MAX_DELETION_REASON } }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Pedir exclusão', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role, data } = await alert.onDidDismiss<{ values: { reason?: string } }>();
  if (role !== 'confirm' || !group.value) return;
  requestDeletion(group.value.id, idsFor('edit'), myUid.value, data?.values?.reason);
}

function cancelDel(): void {
  if (!group.value) return;
  const ids = targetsFor('edit').filter((p) => p.deletionRequest?.status === 'pending').map((p) => p.id);
  cancelDeletion(group.value.id, ids);
}

function denyDel(): void {
  if (group.value) denyDeletion(group.value.id, idsFor('answerDeletion'), myUid.value);
}

/** O outro membro: aprovar exclui o gasto (numa série, as parcelas abertas com pedido). */
async function approveDel(): Promise<void> {
  const e = expense.value;
  if (!e || !group.value) return;
  const targets = targetsFor('answerDeletion');
  const alert = await alertController.create({
    header: e.installment ? 'Excluir a compra parcelada?' : 'Excluir gasto?',
    message: e.installment
      ? `"${e.description}": ${targets.length} ${targets.length === 1 ? 'parcela sai' : 'parcelas saem'} do saldo.`
      : `"${e.description}" de ${formatBRL(e.totalCents)} sai do saldo de ${monthName(e.competence)}.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Excluir', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive' || !group.value) return;
  approveDeletion(group.value.id, targets);
  router.replace({ name: 'painel', query: { mes: e.competence } });
}

/**
 * Uma tentativa pelo servidor; se falhar, no Android, oferece abrir a nota no
 * aparelho, uma vez, visível. Nada se repete sozinho; o limite de 1 minuto é
 * contado no servidor.
 */
async function retryNfce(): Promise<void> {
  const g = group.value;
  const e = expense.value;
  if (!g || !e || e.receipt.type !== 'nfce' || !e.receipt.nfceUrl || retryBusy.value || retryLocked.value) return;
  const key = e.receipt.nfceKey;
  const url = e.receipt.nfceUrl;
  retryBusy.value = true;
  retryMessage.value = null;
  try {
    const r = await retryNfceOnServer(g.id, e.id);
    if (r.retryAt) retryAt.value = r.retryAt;
    now.value = Date.now();
    if (r.ok) {
      retryMessage.value = 'Nota conferida pela SEFAZ.';
      return;
    }
    if (r.limited || !notaWebViewAvailable()) {
      retryMessage.value = r.limited ? r.message : `${r.message} Use "Ver a nota na SEFAZ" para conferir.`;
      return;
    }
    const alert = await alertController.create({
      header: 'Abrir a nota no aparelho?',
      message: 'O servidor não conseguiu consultar a SEFAZ. Dá para abrir a página da nota aqui no aparelho, uma vez; os dados lidos ficam marcados como "sem conferência da SEFAZ".',
      buttons: [
        { text: 'Agora não', role: 'cancel' },
        { text: 'Abrir no aparelho', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    const device = await readNfceOnDevice(url, NFCE_BUDGET_MS);
    if ('data' in device) {
      // Itens oficiais já gravados não são trocados pelos lidos no aparelho.
      const existing = nfceItemsByKey.value.get(key);
      if (device.items && canWriteDeviceItems(existing)) {
        saveItemsAlone(g.id, { key, items: device.items, page: { issuerName: device.data.issuerName, date: device.data.date } }, e.id, e.description);
      }
      const items = device.items ? ` ${device.items.items.length} ${device.items.items.length === 1 ? 'item lido' : 'itens lidos'}.` : ' Os itens não puderam ser lidos.';
      retryMessage.value = `Nota lida no aparelho, sem conferência da SEFAZ: ${device.data.issuerName} · ${formatBRL(device.data.totalCents)}.${items}`;
    } else {
      retryMessage.value = 'A SEFAZ não liberou a consulta. Use "Ver a nota na SEFAZ" para conferir.';
    }
  } finally {
    retryBusy.value = false;
  }
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
  color: var(--app-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.items-btn {
  margin-top: 8px;
  height: 44px;
  width: 100%;
}

.items-alert {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: var(--app-radius-control);
  background: var(--app-danger-bg);
  color: var(--app-danger);
}

.items-alert p {
  margin: 0 0 4px;
}

.items-alert .link {
  color: inherit;
  font-weight: 700;
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

.icon-btn.light {
  color: #fff;
}

</style>
