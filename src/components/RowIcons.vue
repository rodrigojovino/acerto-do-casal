<template>
  <span class="row-icons" @click.capture="swallowClick" @contextmenu.prevent>
    <span
      v-for="(o, i) in icons.origins"
      :key="`o${i}`"
      class="ico gray"
      role="img"
      :aria-label="o.label"
     
      @pointerdown="hold($event, o.label)" @pointerenter="hover($event, o.label)" @pointerleave="unhover"
    >
      <IconGlyph :name="o.kind" />
    </span>
    <span v-if="icons.recurring" class="ico gray" role="img" :aria-label="RECURRING_LABEL" @pointerdown="hold($event, RECURRING_LABEL)" @pointerenter="hover($event, RECURRING_LABEL)" @pointerleave="unhover">
      <IconGlyph name="recurring" />
    </span>
    <span v-if="icons.parcel" class="num-tag" role="img" :aria-label="icons.parcel.label" @pointerdown="hold($event, icons.parcel.label)" @pointerenter="hover($event, icons.parcel.label)" @pointerleave="unhover">
      {{ icons.parcel.text }}
    </span>
    <span v-if="icons.split" class="num-tag" role="img" :aria-label="icons.split.label" @pointerdown="hold($event, icons.split.label)" @pointerenter="hover($event, icons.split.label)" @pointerleave="unhover">
      {{ icons.split.text }}
    </span>
    <span
      class="indicator"
      :class="icons.indicator.kind"
      role="img"
      :aria-label="icons.indicator.dot ? `${icons.indicator.label} (ação sua)` : icons.indicator.label"
     
      @pointerdown="hold($event, icons.indicator.label)"
      @pointerenter="hover($event, icons.indicator.label)"
      @pointerleave="unhover"
    >
      <IconGlyph :name="icons.indicator.kind" />
      <span v-if="icons.indicator.dot" class="dot" aria-hidden="true" />
    </span>
    <span v-if="tip" class="tip" role="status" :style="{ right: `${tip.right}px` }">{{ tip.text }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import IconGlyph from './IconGlyph.vue';
import { RECURRING_LABEL, type RowIcons } from '@/services/rowIcons';

/**
 * Ícones da linha de gasto (`rowIcons` em `src/services/rowIcons.ts`): origem,
 * recorrente e números em cinza, e o indicador de situação na ponta. Tocar e
 * segurar (ou passar o mouse) mostra o nome num balão, sem abrir o gasto; o
 * nome completo também vai para leitores de tela.
 */
defineProps<{ icons: RowIcons }>();

const tip = ref<{ text: string; right: number } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** O toque virou "segurar": o clique que vem depois não abre o gasto. */
let held = false;

function clear(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function hold(e: PointerEvent, text: string): void {
  clear();
  held = false;
  const target = e.currentTarget as HTMLElement;
  const box = target.parentElement!.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  timer = setTimeout(() => {
    held = true;
    tip.value = { text, right: Math.max(0, box.right - r.right) };
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (tip.value = null), 2500);
  }, 450);
  const cancel = () => {
    clear();
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('scroll', cancel, true);
  };
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('scroll', cancel, true);
}

/** Com mouse (versão web, prévia no PC): o balão aparece ao passar o ponteiro. */
function hover(e: PointerEvent, text: string): void {
  if (e.pointerType !== 'mouse') return;
  const target = e.currentTarget as HTMLElement;
  const box = target.parentElement!.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (hideTimer) clearTimeout(hideTimer);
  tip.value = { text, right: Math.max(0, box.right - r.right) };
}

function unhover(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && !held) tip.value = null;
}

function swallowClick(e: MouseEvent): void {
  if (!held) return;
  held = false;
  e.preventDefault();
  e.stopPropagation();
}

onBeforeUnmount(() => {
  clear();
  if (hideTimer) clearTimeout(hideTimer);
});
</script>

<style scoped>
.row-icons {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  -webkit-touch-callout: none;
  user-select: none;
}

.ico {
  display: inline-flex;
  width: var(--app-row-icon);
  height: var(--app-row-icon);
}

.gray {
  color: #6f6e69;
}

.num-tag {
  font-size: var(--app-row-number-font);
  font-weight: 700;
  color: #5f5f5a;
  white-space: nowrap;
}

/* Indicador de situação: círculo, cores e claridades diferentes. */
.indicator {
  position: relative;
  box-sizing: border-box;
  width: var(--app-row-indicator);
  height: var(--app-row-indicator);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.indicator :deep(svg) {
  width: 58%;
  height: 58%;
}

.validated {
  background: #1e6b3a;
  color: #ffffff;
}

.auto {
  background: #ffffff;
  border: 1.6px solid #1e6b3a;
  color: #1e6b3a;
}

.pending {
  background: #fcebd9;
  color: #b25a00;
}

.awaiting {
  background: #e4e3de;
  color: #4a4a46;
}

.returned,
.deletion {
  background: #fbe2df;
  color: #a3271d;
}

.forecast {
  background: #ffffff;
  border: 1.6px dashed #8a8984;
  color: #6b6a65;
}

/* Próxima ação é de quem vê. */
.dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #2457c5;
  box-shadow: 0 0 0 1.5px #ffffff;
}

.tip {
  position: absolute;
  bottom: calc(100% + 6px);
  max-width: 240px;
  padding: 6px 9px;
  border-radius: 8px;
  background: #1c1c1a;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  white-space: normal;
  width: max-content;
  z-index: 5;
  pointer-events: none;
}
</style>
