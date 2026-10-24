<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Foto do cartão</h1>
        </header>

        <p class="hint">
          A foto do casal fica ao fundo do cartão de saldo, para os dois. Arraste a foto no cartão para escolher a parte visível.
        </p>

        <!-- Prévia: o mesmo cartão do Painel, no mês aberto e no fechado -->
        <section class="balance" :class="{ 'with-photo': !!draft }" aria-label="Prévia do cartão com o mês aberto">
          <CoverPhoto v-if="draft" :src="draft.src" :framing="framing" draggable @minimum="(v) => (minimums.open = v)" @move="move" />
          <p class="muted small" data-need="small">Saldo do acerto até agora</p>
          <div>
            <p class="who" data-need="small">Você deve para {{ partnerFirstName }}</p>
            <p class="amount num" data-need="large">R$ 821,23</p>
          </div>
          <div class="paid">
            <div><span class="muted" data-need="small">Você pagou</span><span class="num strong" data-need="small">R$ 3.105,40</span></div>
            <div><span class="muted" data-need="small">{{ partnerFirstName }} pagou</span><span class="num strong" data-need="small">R$ 4.747,86</span></div>
          </div>
          <p class="forecast-line small">
            <span class="muted" data-need="small">Previsto em recorrentes</span><span class="num strong" data-need="small">R$ 800,00</span>
          </p>
        </section>

        <section v-if="draft" class="balance with-photo" aria-label="Prévia do cartão com o mês fechado">
          <CoverPhoto :src="draft.src" :framing="framing" draggable @minimum="(v) => (minimums.closed = v)" @move="move" />
          <p class="muted small" data-need="small">Acerto de setembro · pago</p>
          <div>
            <p class="who" data-need="small">Você pagou a {{ partnerFirstName }}</p>
            <p class="amount num" data-need="large">R$ 821,23</p>
            <p class="muted small" data-need="small">PIX · 02/10</p>
          </div>
          <div class="paid">
            <div><span class="muted" data-need="small">Você pagou</span><span class="num strong" data-need="small">R$ 3.105,40</span></div>
            <div><span class="muted" data-need="small">{{ partnerFirstName }} pagou</span><span class="num strong" data-need="small">R$ 1.462,94</span></div>
          </div>
        </section>

        <p v-if="error" class="alert-error" role="alert">{{ error }}</p>

        <section v-if="draft" class="card controls">
          <label class="slider">
            <span class="name">Escurecimento</span>
            <input v-model.number="framing.dark" type="range" :min="minDark" :max="COVER_DARK_MAX" step="0.01" @input="clampDark" />
            <span class="value">{{ pct(framing.dark) }}</span>
          </label>
          <div class="min-row">
            <button class="link" type="button" @click="framing.dark = minDark">Escurecimento no mínimo ({{ pct(minDark) }})</button>
            <span class="hint">O mínimo garante a leitura do saldo com esta foto e este enquadramento.</span>
          </div>
          <label class="slider">
            <span class="name">Desfoque</span>
            <input v-model.number="framing.blur" type="range" min="0" :max="COVER_BLUR_MAX" step="1" />
            <span class="value">{{ framing.blur === 0 ? 'sem' : `${framing.blur} px` }}</span>
          </label>
          <label class="slider">
            <span class="name">Aproximar</span>
            <input v-model.number="framing.zoom" type="range" :min="COVER_ZOOM_MIN" :max="COVER_ZOOM_MAX" step="0.1" />
            <span class="value">{{ framing.zoom.toFixed(1).replace('.', ',') }}×</span>
          </label>
          <p class="hint">Aproxime para mover a foto nos dois sentidos.</p>
        </section>

        <div class="actions">
          <button v-if="draft" class="btn primary" type="button" :disabled="!dirty" @click="save">Salvar</button>
          <button class="btn outline" type="button" :disabled="busy" @click="choose">{{ draft ? 'Trocar foto' : 'Escolher foto' }}</button>
          <button v-if="cover" class="btn danger" type="button" @click="remove">Remover foto</button>
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage, actionSheetController, alertController } from '@ionic/vue';
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import CoverPhoto from '@/components/CoverPhoto.vue';
import {
  COVER_BLUR_MAX,
  COVER_DARK_MAX,
  COVER_DARK_MIN,
  COVER_ZOOM_MAX,
  COVER_ZOOM_MIN,
  CoverTooLargeError,
  DEFAULT_FRAMING,
  fitCoverImage,
  type CoverFraming,
} from '@/domain/cover';
import { blobToBase64, cover, removeCover, saveCoverFraming, saveCoverPhoto } from '@/services/cover';
import type { CoverImage } from '@/services/coverData';
import { PhotoError, compressImage, pickOriginalPhoto, type PhotoSource } from '@/services/photo';
import { partnerFirstName } from '@/services/session';

const router = useRouter();

/** Foto em edição: a salva ou uma nova escolhida agora (ainda não gravada). */
const draft = ref<{ src: string; photo?: CoverImage } | null>(cover.value ? { src: cover.value.src } : null);
const framing = reactive<CoverFraming>(cover.value ? pick(cover.value) : { ...DEFAULT_FRAMING });
const saved = ref<CoverFraming | null>(cover.value ? pick(cover.value) : null);
const minimums = reactive({ open: COVER_DARK_MIN, closed: COVER_DARK_MIN });
const busy = ref(false);
const error = ref<string | null>(null);

function pick(f: CoverFraming): CoverFraming {
  return { x: f.x, y: f.y, zoom: f.zoom, dark: f.dark, blur: f.blur };
}

/** Mínimo do controle: o maior entre o piso (40%) e o calculado nos dois cartões. */
const minDark = computed(() => Math.max(COVER_DARK_MIN, minimums.open, minimums.closed));
const pct = (v: number) => `${Math.round(v * 100)}%`;

function clampDark(): void {
  if (framing.dark < minDark.value) framing.dark = minDark.value;
}

function move(pos: { x: number; y: number }): void {
  framing.x = pos.x;
  framing.y = pos.y;
}

const dirty = computed(() => {
  if (!draft.value) return false;
  if (draft.value.photo) return true;
  const s = saved.value;
  return !s || (Object.keys(framing) as Array<keyof CoverFraming>).some((k) => framing[k] !== s[k]);
});

async function choose(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Foto do cartão',
    buttons: [
      { text: 'Tirar foto', data: 'camera' },
      { text: 'Escolher da galeria', data: 'gallery' },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
  const { data } = await sheet.onDidDismiss<PhotoSource>();
  if (!data) return;
  busy.value = true;
  error.value = null;
  try {
    const original = await pickOriginalPhoto(data);
    if (!original) return;
    // Comprime (e recomprime, se preciso) até caber no documento; senão, mensagem clara.
    const fitted = await fitCoverImage(async (maxBytes) => {
      const c = await compressImage(original, maxBytes);
      return { base64: await blobToBase64(c.data), width: c.size.width, height: c.size.height };
    });
    draft.value = {
      src: `data:image/jpeg;base64,${fitted.base64}`,
      photo: { image: fitted.base64, width: fitted.width, height: fitted.height },
    };
    // Foto nova: começa centralizada, sem aproximação nem desfoque.
    Object.assign(framing, { ...DEFAULT_FRAMING, dark: Math.max(DEFAULT_FRAMING.dark, minDark.value) });
  } catch (err) {
    error.value = err instanceof PhotoError || err instanceof CoverTooLargeError ? err.message : 'Não foi possível preparar a foto. Tente outra.';
  } finally {
    busy.value = false;
  }
}

function save(): void {
  if (!draft.value) return;
  // Nunca grava abaixo do mínimo calculado para a leitura.
  const value = { ...pick(framing), dark: Math.max(framing.dark, minDark.value) };
  if (draft.value.photo) saveCoverPhoto(draft.value.photo, value);
  else saveCoverFraming(value);
  goBack();
}

async function remove(): Promise<void> {
  const alert = await alertController.create({
    header: 'Remover a foto do cartão?',
    message: `O cartão de saldo volta a ficar sem foto, para você e para ${partnerFirstName.value}.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Remover', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'confirm') return;
  removeCover();
  goBack();
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'ajustes' });
}
</script>

<style scoped>
/* Mesmo cartão do Painel (PainelPage.vue), para a prévia ser fiel. */
.balance {
  position: relative;
  overflow: hidden;
  background: var(--app-text);
  color: #fff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  user-select: none;
}

.balance p {
  margin: 0;
}

.balance.with-photo > * {
  position: relative;
}

.balance.with-photo {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
  cursor: grab;
}

.muted {
  color: #c9c8c2;
}

.balance.with-photo .muted {
  color: #e6e5e0;
}

.small {
  font-size: 13px;
  font-weight: 600;
}

.who {
  font-size: 15px;
  font-weight: 600;
}

.amount {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.paid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  font-size: 13px;
}

.paid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strong {
  font-weight: 700;
}

.forecast-line {
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  justify-content: space-between;
}

.balance.with-photo .forecast-line {
  border-top-color: rgba(255, 255, 255, 0.28);
}

.controls {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.controls .hint {
  margin: 0;
}

.slider {
  display: grid;
  grid-template-columns: 104px 1fr 52px;
  gap: 10px;
  align-items: center;
}

.slider .name {
  font-size: 14px;
  font-weight: 700;
}

.slider input {
  width: 100%;
  accent-color: var(--app-accent);
}

.slider .value {
  font-size: 14px;
  font-weight: 700;
  text-align: right;
}

.min-row {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.min-row .link {
  min-height: 36px;
  align-self: flex-start;
  font-weight: 700;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
