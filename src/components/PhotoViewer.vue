<template>
  <ion-modal :is-open="!!url" @did-dismiss="emit('close')">
    <div class="viewer">
      <div class="head">
        <span class="strong">{{ title }}</span>
        <button class="icon-btn light" type="button" aria-label="Fechar" @click="emit('close')">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div
        ref="stage"
        class="stage"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel.prevent="onWheel"
      >
        <img
          v-if="url"
          :src="url"
          :alt="alt"
          draggable="false"
          :style="imageStyle"
          @load="onLoad"
        />
      </div>
      <p class="hint">Pince para aproximar · toque duas vezes para ampliar</p>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { IonModal } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  doubleTap,
  fitSize,
  initialState,
  pan,
  pinch,
  zoomAt,
  type PinchStart,
  type Size,
  type ZoomState,
} from '@/domain/zoom';

/**
 * Foto ampliável em tela cheia (comprovante do gasto, foto da nota, PIX), como
 * a galeria do celular: abre inteira, pinça aproxima e afasta centrada nos
 * dedos (até 5x), toque duplo alterna entre inteira e 2,5x no ponto tocado,
 * arrastar alcança todas as bordas sem passar delas. Fecha com ✕ e com o
 * voltar do Android (o Ionic fecha o modal). A conta fica em `src/domain/zoom.ts`.
 */
const props = defineProps<{ url: string | null; title: string; alt: string }>();
const emit = defineEmits<{ close: [] }>();

const stage = ref<HTMLElement | null>(null);
const photo = ref<Size>({ width: 0, height: 0 });
const view = ref<Size>({ width: 0, height: 0 });
const state = ref<ZoomState>({ scale: 1, x: 0, y: 0 });
const fit = computed(() => fitSize(photo.value, view.value));

const imageStyle = computed(() => ({
  width: `${fit.value.width}px`,
  height: `${fit.value.height}px`,
  transform: `translate3d(${state.value.x}px, ${state.value.y}px, 0) scale(${state.value.scale})`,
}));

let observer: ResizeObserver | null = null;

function measure(): void {
  const el = stage.value;
  if (!el) return;
  view.value = { width: el.clientWidth, height: el.clientHeight };
}

function reset(): void {
  measure();
  state.value = initialState(fit.value, view.value);
}

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement;
  photo.value = { width: img.naturalWidth, height: img.naturalHeight };
  reset();
  if (!observer && stage.value && typeof ResizeObserver !== 'undefined') {
    // Girar o celular: a foto volta inteira na nova tela.
    observer = new ResizeObserver(() => reset());
    observer.observe(stage.value);
  }
}

// Outra foto (ou fechou): começa de novo, inteira.
watch(
  () => props.url,
  () => {
    pointers.clear();
    pinchStart = null;
    observer?.disconnect();
    observer = null;
  },
);
onBeforeUnmount(() => observer?.disconnect());

// ---- Gestos (Pointer Events: toque, caneta e mouse) ----
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: PinchStart | null = null;
let lastTap: { time: number; x: number; y: number } | null = null;
let moved = false;

function local(e: PointerEvent): { x: number; y: number } {
  const rect = stage.value!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function twoFingers(): { distance: number; midX: number; midY: number } {
  const [a, b] = [...pointers.values()];
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
}

function onDown(e: PointerEvent): void {
  stage.value?.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  moved = false;
  if (pointers.size === 2) {
    const f = twoFingers();
    pinchStart = { state: state.value, ...f };
  }
}

function onMove(e: PointerEvent): void {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0) moved = true;
  if (pointers.size >= 2 && pinchStart) {
    const f = twoFingers();
    state.value = pinch(pinchStart, f.distance, f.midX, f.midY, fit.value, view.value);
  } else if (pointers.size === 1) {
    state.value = pan(state.value, p.x - prev.x, p.y - prev.y, fit.value, view.value);
  }
}

function onUp(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (!p || e.type === 'pointercancel') return;
  // Toque duplo: dois toques curtos, sem arrastar, perto um do outro.
  if (pointers.size === 0 && !moved) {
    const now = Date.now();
    if (lastTap && now - lastTap.time < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
      state.value = doubleTap(state.value, p.x, p.y, fit.value, view.value);
      lastTap = null;
    } else {
      lastTap = { time: now, ...p };
    }
  }
}

/** Mouse (versão web): a roda aproxima e afasta no ponteiro. */
function onWheel(e: WheelEvent): void {
  const rect = stage.value!.getBoundingClientRect();
  const factor = Math.exp(-e.deltaY / 300);
  state.value = zoomAt(state.value, state.value.scale * factor, e.clientX - rect.left, e.clientY - rect.top, fit.value, view.value);
}
</script>

<style scoped>
.viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #111;
  color: #fff;
  padding-top: var(--app-safe-top);
  padding-bottom: var(--app-safe-bottom);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 16px;
}

/* Os gestos são todos do visualizador: o navegador não rola nem amplia a página. */
.stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.stage img {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  transform-origin: 0 0;
  will-change: transform;
  -webkit-user-drag: none;
}

.hint {
  margin: 0;
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: #c9c8c2;
}
</style>
