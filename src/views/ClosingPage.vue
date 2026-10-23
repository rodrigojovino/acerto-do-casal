<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{{ monthDoc?.status === 'closed' ? `${title} fechado` : `Fechar ${monthName(month)}` }}</h1>
        </header>

        <p v-if="!loaded" class="hint">Carregando…</p>
        <p v-else-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>

        <template v-else>
          <!-- Resultado -->
          <section class="result" aria-live="polite">
            <p class="muted small">Acerto de {{ monthName(month) }}</p>
            <p class="who">{{ resultText.who }}</p>
            <p v-if="breakdown.result" class="amount num">{{ formatBRL(breakdown.result.amountCents) }}</p>
          </section>

          <BreakdownCard :breakdown="breakdown" :viewer-uid="myUid" />

          <!-- Mês já fechado -->
          <template v-if="monthDoc?.status === 'closed'">
            <p class="alert-ok" role="status">Mês fechado{{ closedText }}. Os gastos não podem mais ser alterados.</p>
            <section v-if="monthDoc.payments.length > 0" class="card payments" aria-labelledby="pag-fechado-titulo">
              <h2 id="pag-fechado-titulo" class="calc-title">Pagamentos do acerto</h2>
              <PaymentList :payments="monthDoc.payments" :viewer-uid="myUid" />
            </section>
            <ReopenPanel v-if="group" :group-id="group.id" :month="month" :month-doc="monthDoc" :viewer-uid="myUid" />
            <router-link class="btn outline" :to="{ name: 'mes', params: { mes: month } }">Ver no histórico</router-link>
          </template>

          <template v-else>
            <!-- O que impede fechar -->
            <section v-if="blockers.length > 0" class="card blockers" aria-labelledby="falta-titulo">
              <h2 id="falta-titulo" class="calc-title">Antes de fechar, resolva</h2>
              <ul>
                <li v-for="b in blockers" :key="b.kind">{{ blockerText(b) }}</li>
              </ul>
              <router-link class="btn outline" :to="{ name: 'pendencias' }">Ir para Pendências</router-link>
            </section>

            <!-- Pagamentos já registrados -->
            <section v-if="(monthDoc && monthDoc.payments.length > 0) || uploading" class="card payments" aria-labelledby="pag-titulo">
              <h2 id="pag-titulo" class="calc-title">Pagamentos do acerto</h2>
              <PaymentList :payments="monthDoc?.payments ?? []" :viewer-uid="myUid" :uploading="uploading" />
            </section>

            <!-- O que falta pagar -->
            <section v-if="remaining" class="card pay" aria-labelledby="pagar-titulo">
              <h2 id="pagar-titulo" class="calc-title">{{ payTitle }}</h2>
              <template v-if="remaining.fromUid === myUid">
                <p class="hint">{{ payHint }}</p>
                <div class="grid-2">
                  <button class="btn outline" type="button" :disabled="busy || !isOnline" @click="payPix">PIX (foto do comprovante)</button>
                  <button class="btn outline" type="button" :disabled="busy || !isOnline" @click="payCash">Pago em dinheiro</button>
                </div>
              </template>
              <p v-else class="hint">Aguardando {{ partnerFirstName }} registrar o pagamento. Quem paga é quem registra.</p>
            </section>

            <p v-if="!isOnline" class="alert-warn" role="status">Sem conexão: fechar e registrar o pagamento exigem internet.</p>
            <p v-if="reasons.includes('future')" class="hint">{{ title }} ainda não começou: mês futuro não pode ser fechado.</p>
            <p v-if="actionError" class="alert-error" role="alert">{{ actionError }}</p>

            <button class="btn primary" type="button" :disabled="reasons.length > 0 || busy" @click="confirmClose">
              {{ busy ? 'Aguarde…' : `Fechar ${monthName(month)}` }}
            </button>
            <p class="hint">Fechado, os gastos do mês não podem mais ser alterados. Reabrir exige o pedido de um e a aprovação do outro.</p>
          </template>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, actionSheetController, alertController } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { closeBlockers, closeReasons, monthBreakdown, remainingTransfer, type Blocker } from '@/domain/closing';
import { formatDateBR, monthLabel, monthName, monthOf, todayInSaoPaulo } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import type { Members } from '@/domain/settlement';
import {
  closeMonth,
  closingErrorMessage,
  registerPayment,
  watchMonth,
  type MonthDoc,
} from '@/services/closing';
import { watchMonthExpenses, type Expense } from '@/services/expenses';
import PaymentList from '@/components/PaymentList.vue';
import BreakdownCard from '@/components/BreakdownCard.vue';
import ReopenPanel from '@/components/ReopenPanel.vue';
import type { Transfer } from '@/domain/settlement';
import { PhotoError, pickReceiptPhoto, type PhotoSource } from '@/services/photo';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';
import { isOnline } from '@/services/sync';

const route = useRoute();
const router = useRouter();

// Fixado na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const month = String(route.params.mes);
const title = monthLabel(month);

const myUid = computed(() => user.value?.uid ?? '');
const members = computed<Members>(() => [myUid.value, partnerUid.value ?? ''] as const);

// ---- Gastos e documento do mês em tempo real ----
const expenses = ref<Expense[]>([]);
const monthDoc = ref<MonthDoc | null>(null);
const loadedExpenses = ref(false);
const loadedMonth = ref(false);
const loaded = computed(() => loadedExpenses.value && loadedMonth.value);
const loadError = ref<string | null>(null);
let stops: Array<() => void> = [];

watch(
  () => group.value?.id,
  (groupId) => {
    stops.forEach((s) => s());
    stops = [];
    if (!groupId) return;
    const fail = () => (loadError.value = 'Não foi possível carregar o mês. Verifique a conexão.');
    stops.push(
      watchMonthExpenses(groupId, month, (snap) => {
        expenses.value = snap.expenses;
        loadedExpenses.value = true;
      }, fail),
      watchMonth(groupId, month, (doc) => {
        monthDoc.value = doc;
        loadedMonth.value = true;
      }, fail),
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stops.forEach((s) => s()));

// ---- Cálculo: funções de src/domain/closing.ts ----
const breakdown = computed(() =>
  monthDoc.value?.status === 'closed' && monthDoc.value.summary
    ? monthDoc.value.summary
    : monthBreakdown(expenses.value, members.value),
);
const blockers = computed(() => closeBlockers(expenses.value));
const remaining = computed(() => remainingTransfer(breakdown.value.result, monthDoc.value?.payments ?? [], members.value));
const reasons = computed(() =>
  closeReasons({
    month,
    currentMonth: monthOf(todayInSaoPaulo()),
    closed: monthDoc.value?.status === 'closed',
    online: isOnline.value,
    blockers: blockers.value,
    remaining: remaining.value,
  }),
);

const resultText = computed(() => {
  const r = breakdown.value.result;
  if (!r) return { who: 'Ninguém deve nada' };
  return r.fromUid === myUid.value
    ? { who: `Você paga a ${partnerFirstName.value}` }
    : { who: `${partnerFirstName.value} te paga` };
});

const BLOCKERS: Record<Blocker['kind'], [string, string]> = {
  pending: ['gasto pendente de aprovação', 'gastos pendentes de aprovação'],
  returned: ['gasto devolvido para correção', 'gastos devolvidos para correção'],
  awaiting: ['recorrente aguardando a confirmação do valor', 'recorrentes aguardando a confirmação do valor'],
  deletion: ['pedido de exclusão aguardando resposta', 'pedidos de exclusão aguardando resposta'],
  photo: ['foto de comprovante ainda não enviada', 'fotos de comprovante ainda não enviadas'],
};
const blockerText = (b: Blocker) => `${b.count} ${BLOCKERS[b.kind][b.count === 1 ? 0 : 1]}`;

/** Pagamentos anteriores (reabertura) mudam o texto: complemento ou devolução. */
const payTitle = computed(() => {
  const r = remaining.value;
  if (!r) return '';
  const paidBefore = (monthDoc.value?.payments.length ?? 0) > 0;
  const to = r.toUid === myUid.value ? 'você' : firstNameOf(r.toUid);
  const from = r.fromUid === myUid.value ? 'Você' : firstNameOf(r.fromUid);
  const verb = !paidBefore ? 'paga' : isRefund.value ? 'devolve' : 'paga a diferença de';
  return `${from} ${verb} ${formatBRL(r.amountCents)} a ${to}`;
});

/** O que falta vai no sentido contrário de um pagamento já feito (o saldo diminuiu). */
const isRefund = computed(() => {
  const r = remaining.value;
  return !!r && (monthDoc.value?.payments ?? []).some((p) => p.fromUid === r.toUid);
});

const payHint = computed(() =>
  isRefund.value
    ? 'O saldo diminuiu depois do pagamento: devolva a diferença e registre aqui.'
    : 'Pague e registre aqui, com a foto do comprovante PIX ou como pago em dinheiro.',
);

const closedText = computed(() => {
  const d = monthDoc.value;
  if (!d?.closedAt) return '';
  return ` em ${formatDateBR(todayInSaoPaulo(d.closedAt))} por ${d.closedBy === myUid.value ? 'você' : firstNameOf(d.closedBy ?? '')}`;
});

// ---- Ações (online, pelas Functions) ----
const busy = ref(false);
const actionError = ref<string | null>(null);
/** PIX deste aparelho com a foto ainda subindo (mostrado na lista até registrar). */
const uploading = ref<Transfer | null>(null);

async function run(action: () => Promise<unknown>): Promise<boolean> {
  if (!group.value) return false;
  busy.value = true;
  actionError.value = null;
  try {
    await action();
    return true;
  } catch (err) {
    actionError.value = err instanceof PhotoError || (err instanceof Error && !('code' in err)) ? err.message : closingErrorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

async function payPix(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Comprovante do PIX',
    buttons: [
      { text: 'Tirar foto', data: 'camera' },
      { text: 'Escolher da galeria', data: 'gallery' },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
  const { data } = await sheet.onDidDismiss<PhotoSource>();
  if (data !== 'camera' && data !== 'gallery') return;
  await run(async () => {
    const photo = await pickReceiptPhoto(data);
    if (!photo || !group.value || !remaining.value) return;
    uploading.value = { ...remaining.value };
    try {
      await registerPayment(group.value.id, month, 'pix', photo.data);
    } finally {
      uploading.value = null;
    }
  });
}

async function payCash(): Promise<void> {
  const r = remaining.value;
  if (!r) return;
  const alert = await alertController.create({
    header: 'Pago em dinheiro?',
    message: `Registrar ${formatBRL(r.amountCents)} pago em dinheiro a ${firstNameOf(r.toUid)}.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Registrar', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'confirm') return;
  await run(() => registerPayment(group.value!.id, month, 'cash'));
}

async function confirmClose(): Promise<void> {
  const alert = await alertController.create({
    header: `Fechar ${monthName(month)}?`,
    message: 'Os gastos do mês ficam travados. Reabrir exige o pedido de um e a aprovação do outro.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Fechar', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'confirm') return;
  await run(() => closeMonth(group.value!.id, month));
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'painel', query: { mes: month } });
}
</script>

<style scoped>
.result {
  padding: 18px;
  border-radius: var(--app-radius-card, 16px);
  background: var(--app-accent-dark, #1a3f94);
  color: #ffffff;
}

.result p {
  margin: 0;
}

.result .muted {
  opacity: 0.8;
}

.who {
  font-size: 16px;
  font-weight: 700;
}

.amount {
  font-size: 30px;
  font-weight: 800;
}

.blockers,
.payments,
.pay {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calc-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

.blockers ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}

.alert-ok,
.alert-warn {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  font-size: 14px;
}

.alert-ok {
  background: #e2f1e6;
  color: #1e6b3a;
}

.alert-warn {
  background: #fcebd9;
  color: #7a3700;
}
</style>
