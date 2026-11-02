<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Teste: abrir nota no app</h1>
        </header>

        <section class="card intro">
          <p class="tag">Experimental</p>
          <p class="hint">
            Verifica se a página oficial da NFC-e de SP carrega dentro do app. Leia o QR da nota e abra no app e no navegador,
            para comparar. Nada é gravado e o conteúdo da página não é lido.
          </p>
        </section>

        <p v-if="!available" class="alert-error" role="alert">Este teste só funciona no app Android.</p>

        <button class="btn primary" type="button" :disabled="!available || busy" @click="scan">Ler QR da nota</button>
        <p v-if="error" class="alert-error" role="alert">{{ error }}</p>

        <section v-if="scanned" class="card result">
          <p class="strong">{{ scannedLabel }}</p>
          <template v-if="scanned.spUrl">
            <div class="actions">
              <button class="btn primary" type="button" :disabled="busy" @click="openInApp">Abrir no app</button>
              <button class="btn outline" type="button" :disabled="busy" @click="openInBrowser">Abrir no navegador</button>
            </div>
            <p class="hint">Uma abertura por toque, sem repetir sozinho.</p>
          </template>
          <p v-else class="hint">Esta nota não é NFC-e de SP: a página de consulta automática só existe para SP.</p>
        </section>

        <section v-if="report" class="card report" aria-live="polite">
          <p class="strong">O que o WebView informou</p>
          <p v-for="(line, i) in report.page" :key="`p${i}`" class="hint">{{ line }}</p>
          <p class="strong small-title">Diagnóstico do WebView (sem ler a página)</p>
          <p v-for="(line, i) in report.diagnostics" :key="`d${i}`" class="hint mono">{{ line }}</p>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { QrError, fiscalDocName, scanNfceQr, type ScannedNfce } from '@/services/nfce';
import { notaTestReport, type NotaTestReport } from '@/services/notaTest';
import { notaWebViewAvailable, openNotaInApp, openNotaInBrowser } from '@/services/notaWebView';

/**
 * Tela experimental (temporária): a página oficial da nota no WebView do app,
 * para ver se a SEFAZ-SP a deixa carregar. Fora do fluxo de lançamento.
 */
const router = useRouter();
const available = notaWebViewAvailable();
const scanned = ref<ScannedNfce | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const report = ref<NotaTestReport | null>(null);

const scannedLabel = computed(() => {
  const s = scanned.value;
  return s ? `${fiscalDocName(s.model)} de ${s.uf} · chave terminada em ${s.key.slice(-4)}` : '';
});

async function scan(): Promise<void> {
  error.value = null;
  report.value = null;
  busy.value = true;
  try {
    scanned.value = (await scanNfceQr()) ?? scanned.value;
  } catch (err) {
    error.value = err instanceof QrError ? err.message : 'Não foi possível ler o código.';
  } finally {
    busy.value = false;
  }
}

async function openInApp(): Promise<void> {
  const url = scanned.value?.spUrl;
  if (!url || busy.value) return;
  busy.value = true;
  report.value = null;
  try {
    report.value = notaTestReport(await openNotaInApp(url));
  } catch {
    error.value = 'Não foi possível abrir o WebView.';
  } finally {
    busy.value = false;
  }
}

async function openInBrowser(): Promise<void> {
  const url = scanned.value?.spUrl;
  if (!url || busy.value) return;
  try {
    await openNotaInBrowser(url);
  } catch {
    error.value = 'Não foi possível abrir o navegador.';
  }
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'ajustes' });
}
</script>

<style scoped>
.intro,
.result,
.report {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.intro p,
.result p,
.report p {
  margin: 0;
}

.tag {
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 10px;
  background: #fcebd9;
  color: #b25a00;
  font-size: 12px;
  font-weight: 800;
}

.strong {
  font-weight: 700;
}

.small-title {
  margin-top: 6px !important;
  font-size: 13px;
}

.mono {
  word-break: break-word;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
