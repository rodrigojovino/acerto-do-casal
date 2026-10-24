<template>
  <!-- Posição no estilo do próprio elemento: a regra do cartão "conteúdo acima da foto" não o alcança. -->
  <div class="cover" aria-hidden="true" style="position: absolute; inset: 0; pointer-events: none">
    <canvas ref="canvasEl" class="cover-photo" />
    <div class="cover-veil" :style="{ background: veil }" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  dragFraming,
  effectiveDark,
  luminance,
  minimumDark,
  photoRect,
  veilGradient,
  type CoverFraming,
  type TextRegion,
} from '@/domain/cover';

/**
 * Foto do casal ao fundo do cartão de saldo (o cartão-pai precisa de
 * `position: relative; overflow: hidden`). Desenha a foto enquadrada, com
 * desfoque, e o véu em gradiente; mede os pixels atrás de cada texto marcado
 * com `data-need="small" | "large"` e nunca escurece menos que o mínimo que
 * garante a leitura neste aparelho. Com `draggable`, arrastar o cartão move a foto.
 */
const props = defineProps<{ src: string; framing: CoverFraming; draggable?: boolean }>();
const emit = defineEmits<{ minimum: [value: number]; move: [pos: { x: number; y: number }] }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const minimum = ref(0);
const veil = computed(() => veilGradient(effectiveDark(props.framing.dark, minimum.value)));

const img = new Image();
let loaded = false;
let frame = 0;
let observer: ResizeObserver | null = null;
/** O cartão onde a foto está (o pai do elemento da foto). */
const host = () => canvasEl.value?.parentElement?.parentElement ?? null;

/** Texto "apagado" com foto (mais claro que sem foto, para o contraste). */
const MUTED = luminance(0xe6, 0xe5, 0xe0);

function regions(card: HTMLElement, cv: HTMLCanvasElement): TextRegion[] {
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g || cv.width === 0 || cv.height === 0) return [];
  const box = card.getBoundingClientRect();
  const sx = cv.width / box.width;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  return Array.from(card.querySelectorAll<HTMLElement>('[data-need]')).map((el) => {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor((r.left - box.left) * sx));
    const y0 = Math.max(0, Math.floor((r.top - box.top) * sx));
    const x1 = Math.min(cv.width, x0 + Math.ceil(r.width * sx));
    const y1 = Math.min(cv.height, y0 + Math.ceil(r.height * sx));
    const rows: Array<{ t: number; r: number; g: number; b: number }> = [];
    for (let y = y0; y < y1; y++) {
      let best = { L: -1, r: 0, g: 0, b: 0 };
      for (let x = x0; x < x1; x += 2) {
        const i = (y * cv.width + x) * 4;
        const L = luminance(all[i], all[i + 1], all[i + 2]);
        if (L > best.L) best = { L, r: all[i], g: all[i + 1], b: all[i + 2] };
      }
      rows.push({ t: y / cv.height, r: best.r, g: best.g, b: best.b });
    }
    return { rows, textLuminance: el.classList.contains('muted') ? MUTED : 1, required: el.dataset.need === 'large' ? 3 : 4.5 };
  });
}

function draw(): void {
  frame = 0;
  const cv = canvasEl.value;
  const card = host();
  if (!cv || !card || !loaded) return;
  const box = card.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(box.width * dpr);
  cv.height = Math.round(box.height * dpr);
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  const rect = photoRect(img, box.width, box.height, props.framing);
  g.filter = props.framing.blur > 0 ? `blur(${props.framing.blur * dpr}px)` : 'none';
  g.drawImage(img, rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr);
  g.filter = 'none';
  minimum.value = minimumDark(regions(card, cv));
  emit('minimum', minimum.value);
}

function schedule(): void {
  if (!frame) frame = requestAnimationFrame(draw);
}

img.onload = () => {
  loaded = true;
  schedule();
};
watch(
  () => props.src,
  (src) => {
    loaded = false;
    img.src = src;
  },
  { immediate: true },
);
watch(() => props.framing, schedule, { deep: true });

// ---- Arrastar para enquadrar (horizontal e vertical) ----
let drag: { x0: number; y0: number; start: { x: number; y: number }; id: number } | null = null;

function onDown(e: PointerEvent): void {
  const card = host();
  if (!props.draggable || !card) return;
  drag = { x0: e.clientX, y0: e.clientY, start: { x: props.framing.x, y: props.framing.y }, id: e.pointerId };
  card.setPointerCapture(e.pointerId);
}

function onMove(e: PointerEvent): void {
  const card = host();
  if (!drag || !card || e.pointerId !== drag.id) return;
  const box = card.getBoundingClientRect();
  const rect = photoRect(img, box.width, box.height, props.framing);
  emit('move', dragFraming(drag.start, e.clientX - drag.x0, e.clientY - drag.y0, rect, box.width, box.height));
}

function onUp(): void {
  drag = null;
}

onMounted(() => {
  const card = host();
  if (!card) return;
  observer = new ResizeObserver(schedule);
  observer.observe(card);
  if (props.draggable) {
    card.style.touchAction = 'none';
    card.addEventListener('pointerdown', onDown);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  }
  void document.fonts?.ready.then(schedule);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (frame) cancelAnimationFrame(frame);
  const card = host();
  if (card && props.draggable) {
    card.removeEventListener('pointerdown', onDown);
    card.removeEventListener('pointermove', onMove);
    card.removeEventListener('pointerup', onUp);
    card.removeEventListener('pointercancel', onUp);
  }
});
</script>

<style scoped>
.cover-photo,
.cover-veil {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.cover-photo {
  display: block;
}
</style>
