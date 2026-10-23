<template>
  <input
    ref="input"
    type="text"
    inputmode="numeric"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    :value="text"
    @pointerdown="onPointerDown"
    @focus="onFocus"
    @click="onClick"
    @beforeinput="onBeforeInput"
    @input="onInput"
    @blur="pendingEnd = false"
  />
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { formatBRL } from '@/domain/money';
import { applyMoneyEdit, normalizeMoneyText, type MoneyEdit, type MoneyEditResult } from '@/domain/moneyInput';
import type { Cents } from '@/domain/settlement';

/**
 * Campo de valor no estilo do app do banco (lógica em `src/domain/moneyInput.ts`):
 * - primeiro toque (o campo ganha foco): o cursor vai para o fim, mesmo tocando
 *   à esquerda da vírgula; sair e voltar conta como primeiro toque de novo;
 * - com o campo já em foco, o toque posiciona o cursor;
 * - digitar insere o dígito no cursor e apagar remove o dígito à esquerda; o
 *   cursor fica no mesmo ponto lógico depois da edição;
 * - teclado numérico.
 * Os demais atributos (id, classe, aria-*) passam direto para o `<input>`.
 */
const props = defineProps<{ modelValue: Cents }>();
const emit = defineEmits<{ 'update:modelValue': [value: Cents] }>();

const input = ref<HTMLInputElement | null>(null);
const text = ref(formatBRL(props.modelValue));
/** O próximo posicionamento do cursor pelo navegador é o do primeiro toque: vai para o fim. */
const pendingEnd = ref(false);

// Valor trocado de fora (pré-preenchimento pela nota, carregar o gasto).
watch(
  () => props.modelValue,
  (cents) => {
    const formatted = formatBRL(cents);
    if (formatted !== text.value) text.value = formatted;
  },
);

function setCaret(pos: number): void {
  const el = input.value;
  if (el && document.activeElement === el) el.setSelectionRange(pos, pos);
}

function toEnd(): void {
  setCaret(text.value.length);
}

function onPointerDown(): void {
  // Toque com o campo fora de foco: o navegador põe o cursor no ponto tocado; o
  // app leva para o fim logo depois (no foco e no clique que se seguem).
  if (document.activeElement !== input.value) pendingEnd.value = true;
}

function onFocus(): void {
  pendingEnd.value = true;
  // Depois que o navegador terminar de posicionar o cursor.
  setTimeout(() => {
    if (pendingEnd.value) toEnd();
  }, 0);
}

function onClick(): void {
  if (!pendingEnd.value) return;
  pendingEnd.value = false;
  toEnd();
}

function apply(result: MoneyEditResult): void {
  const el = input.value!;
  text.value = result.text;
  el.value = result.text;
  el.setSelectionRange(result.caret, result.caret);
  if (result.cents !== props.modelValue) emit('update:modelValue', result.cents);
}

function editOf(e: InputEvent): MoneyEdit | null {
  switch (e.inputType) {
    case 'insertText':
    case 'insertReplacementText':
    case 'insertFromPaste':
    case 'insertFromDrop':
      return { type: 'insert', text: e.data ?? e.dataTransfer?.getData('text') ?? '' };
    case 'deleteContentBackward':
    case 'deleteWordBackward':
      return { type: 'backspace' };
    case 'deleteContentForward':
    case 'deleteWordForward':
      return { type: 'delete' };
    default:
      return null;
  }
}

/** Cada tecla é tratada antes de o navegador mexer no texto. */
function onBeforeInput(e: InputEvent): void {
  const el = input.value!;
  // Composição (alguns teclados): fica para a reserva no `input`.
  if (e.isComposing) return;
  const edit = editOf(e);
  if (!edit) return;
  e.preventDefault();
  pendingEnd.value = false;
  const result = applyMoneyEdit(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, edit);
  if (result) apply(result);
}

/**
 * Reserva para teclados que não avisam antes (ou compõem): o navegador já
 * mudou o texto; reconstrói o valor pelos dígitos e devolve o cursor ao mesmo
 * ponto lógico.
 */
function onInput(): void {
  const el = input.value!;
  const result = normalizeMoneyText(el.value, el.selectionStart ?? el.value.length);
  if (result) {
    apply(result);
  } else {
    // Passou do limite: volta ao texto anterior.
    el.value = text.value;
    void nextTick(toEnd);
  }
}
</script>
