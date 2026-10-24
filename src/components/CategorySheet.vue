<template>
  <div class="sheet">
    <header class="head">
      <h2>{{ title }}</h2>
      <button class="icon-btn" type="button" aria-label="Fechar sem salvar" @click="close">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <!-- Só a lista rola; o botão Salvar fica sempre visível. -->
    <div class="list" role="radiogroup" :aria-label="title">
      <p v-if="options.length === 0" class="hint empty">Nenhuma categoria cadastrada ainda: crie a primeira.</p>
      <label v-for="c in options" :key="c.id" class="option" :class="{ checked: selected === c.id }">
        <input v-model="selected" type="radio" name="categoria" :value="c.id" />
        <span>{{ c.active ? c.name : `${c.name} (desativada)` }}</span>
      </label>
      <button class="new" type="button" @click="addNew">+ Nova categoria</button>
    </div>

    <footer class="foot">
      <button class="btn primary save" type="button" :disabled="!selected" @click="confirm">{{ saveLabel }}</button>
      <button class="cancel" type="button" @click="close">Cancelar</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { modalController } from '@ionic/vue';
import { computed, ref } from 'vue';
import { choosableCategories } from '@/domain/categories';
import { categories } from '@/services/categories';
import { askNewCategory } from './categoryDialog';

/**
 * Escolha da categoria ao salvar um gasto (com "Exigir categoria nos gastos"
 * ligada), como painel por baixo da tela. Seleção única; nada pré-marcado num
 * gasto novo; na edição, a categoria atual vem marcada. Fechar (✕, Cancelar,
 * voltar do Android, toque fora) não salva.
 */
const props = defineProps<{ currentId?: string; title: string; saveLabel: string }>();

const selected = ref<string | undefined>(props.currentId);
const options = computed(() => choosableCategories(categories.value, props.currentId));

async function addNew(): Promise<void> {
  const id = await askNewCategory(categories.value);
  // A categoria criada já fica marcada (aparece na lista assim que o cache local a recebe).
  if (id) selected.value = id;
}

function confirm(): void {
  if (selected.value) void modalController.dismiss(selected.value, 'confirm');
}

function close(): void {
  void modalController.dismiss(null, 'cancel');
}
</script>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  background: var(--app-surface);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 12px 6px 20px;
}

.head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 12px 8px;
  display: flex;
  flex-direction: column;
}

.option {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 8px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.option.checked {
  background: #e8eefb;
  color: var(--app-accent);
}

.option input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--app-accent);
  flex: none;
}

.empty {
  padding: 8px;
}

.new {
  align-self: flex-start;
  margin: 6px 8px 0;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--app-accent);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 20px calc(max(var(--app-safe-bottom), 48px) + 4px);
  border-top: 1px solid var(--app-subtle);
}

.save {
  width: 100%;
}

.cancel {
  min-height: 40px;
  border: 0;
  background: none;
  color: var(--app-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
</style>
