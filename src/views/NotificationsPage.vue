<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Avisos</h1>
        </header>

        <!-- Situação da permissão do Android -->
        <section class="card status">
          <template v-if="pushPermission === 'unavailable'">
            <p class="strong">Os avisos chegam no app Android.</p>
            <p class="hint">Nesta versão web, as pendências aparecem só no número da aba Pendências.</p>
          </template>
          <template v-else-if="pushPermission === 'granted'">
            <p class="strong">Avisos ativados neste aparelho.</p>
            <p class="hint">Escolha abaixo o que quer receber. Vale só para os seus avisos; {{ partnerFirstName }} escolhe os próprios.</p>
          </template>
          <template v-else-if="pushPermission === 'denied'">
            <p class="strong">Avisos bloqueados no Android.</p>
            <p class="hint">
              Para receber, abra Configurações do Android › Apps › Gastos › Notificações e permita. Depois volte ao app.
            </p>
            <button class="btn outline" type="button" @click="activate">Tentar ativar de novo</button>
          </template>
          <template v-else>
            <p class="strong">Avisos desligados neste aparelho.</p>
            <p class="hint">{{ invite }}</p>
            <button class="btn primary" type="button" :disabled="busy" @click="activate">Ativar avisos</button>
          </template>
        </section>

        <!-- Categorias -->
        <ul class="card categories">
          <li v-for="c in categories" :key="c.id">
            <label class="toggle">
              <span class="text">
                <span class="strong">{{ c.title }}</span>
                <span class="hint">{{ c.detail }}</span>
              </span>
              <input type="checkbox" role="switch" :checked="isOn(c.id)" @change="toggle(c.id, $event)" />
            </label>
          </li>
        </ul>
        <p class="hint">Você nunca recebe aviso das suas próprias ações.</p>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { NoticeCategory } from '@/domain/notifications';
import { notificationPrefs, setCategory } from '@/services/notificationPrefs';
import { enablePush, pushPermission } from '@/services/push';
import { partnerFirstName } from '@/services/session';

const router = useRouter();
const busy = ref(false);

const invite = computed(
  () =>
    `Receba um aviso quando ${partnerFirstName.value} lançar um gasto, devolver um gasto seu ou registrar o pagamento do acerto.`,
);

const categories = computed<Array<{ id: NoticeCategory; title: string; detail: string }>>(() => [
  { id: 'expenses', title: 'Gastos', detail: `Gasto lançado ou corrigido por ${partnerFirstName.value}, inclusive os para aprovar.` },
  { id: 'returns', title: 'Devoluções', detail: 'Gasto seu recusado ou contestado, com o motivo.' },
  { id: 'settlement', title: 'Acerto e fechamento', detail: 'Pagamento registrado, mês fechado e pedidos de reabertura.' },
  { id: 'recurring', title: 'Recorrentes', detail: 'Cadastro ou reajuste para aprovar e, no dia 1, os valores a confirmar.' },
]);

const isOn = (id: NoticeCategory) => notificationPrefs.value[id] !== false;

function toggle(id: NoticeCategory, event: Event): void {
  setCategory(id, (event.target as HTMLInputElement).checked);
}

async function activate(): Promise<void> {
  busy.value = true;
  try {
    await enablePush();
  } finally {
    busy.value = false;
  }
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'ajustes' });
}
</script>

<style scoped>
.status {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status p {
  margin: 0;
}

.categories {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.categories li + li {
  border-top: 1px solid var(--app-subtle);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
}

.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

input[type='checkbox'] {
  width: 22px;
  height: 22px;
  accent-color: var(--app-accent);
  flex: none;
}

.strong {
  font-weight: 700;
}
</style>
