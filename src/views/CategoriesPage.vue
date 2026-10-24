<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Categorias</h1>
        </header>

        <section class="card">
          <label class="toggle">
            <span class="text">
              <span class="strong">Exigir categoria nos gastos</span>
              <span class="hint">{{ requireHint }}</span>
            </span>
            <input type="checkbox" role="switch" :checked="requireOn" @change="onRequire" />
          </label>
        </section>

        <!-- Lista sugerida: só enquanto o grupo não tem nenhuma categoria. -->
        <section v-if="showSuggestions" class="card suggestions">
          <p class="strong">Lista sugerida</p>
          <p class="hint">Marque as que quiser, edite os nomes e crie. Elas entram nesta ordem.</p>
          <ul>
            <li v-for="(s, i) in suggestions" :key="i">
              <input v-model="s.selected" type="checkbox" :aria-label="`Criar ${s.name || 'esta categoria'}`" />
              <input v-model="s.name" class="input" type="text" :maxlength="MAX_CATEGORY_NAME" :aria-label="`Nome da sugestão ${i + 1}`" />
            </li>
          </ul>
          <div class="actions">
            <button class="btn primary" type="button" :disabled="toCreate.length === 0" @click="createSuggested">
              Criar {{ toCreate.length === 1 ? 'a selecionada' : `as ${toCreate.length} selecionadas` }}
            </button>
            <button class="btn outline" type="button" @click="dismissSuggestions">Descartar sugestões</button>
          </div>
        </section>

        <section class="card new">
          <form class="new-row" novalidate @submit.prevent="addNew">
            <input
              v-model="newName"
              class="input"
              type="text"
              placeholder="Nova categoria"
              aria-label="Nome da nova categoria"
              :maxlength="MAX_CATEGORY_NAME"
            />
            <button class="btn primary add" type="submit">Adicionar</button>
          </form>
          <p v-if="newError" class="field-error">{{ newError }}</p>
        </section>

        <section v-if="sections.active.length > 0">
          <h2 class="section-title">Ativas</h2>
          <p class="hint">Arraste pela alça ≡ ou use as setas. A ordem vale para os dois, na escolha do gasto e nos filtros.</p>
          <div class="card list">
          <ion-reorder-group :disabled="false" @ion-reorder-end="onReorder">
            <ion-item v-for="(c, i) in sections.active" :key="c.id" lines="none" class="cat">
              <div class="cat-row">
                <button class="name" type="button" :aria-label="`${c.name}: renomear ou desativar`" @click="openActions(c)">{{ c.name }}</button>
                <button class="arrow" type="button" :aria-label="`Subir ${c.name}`" :disabled="i === 0" @click="moveCategory(i, i - 1)">
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button class="arrow" type="button" :aria-label="`Descer ${c.name}`" :disabled="i === sections.active.length - 1" @click="moveCategory(i, i + 1)">
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>
              <ion-reorder slot="end" :aria-label="`Arrastar ${c.name}`">
                <span class="handle" aria-hidden="true">≡</span>
              </ion-reorder>
            </ion-item>
          </ion-reorder-group>
          </div>
          <p class="hint">Toque no nome para renomear ou desativar.</p>
        </section>

        <section v-if="sections.inactive.length > 0">
          <h2 class="section-title">Desativadas</h2>
          <p class="hint">Não aparecem na escolha do gasto; continuam nos gastos que já as usam.</p>
          <ul class="card list plain">
            <li v-for="c in sections.inactive" :key="c.id" class="cat-row inactive">
              <span class="name muted">{{ c.name }}</span>
              <button class="link" type="button" @click="setCategoryActive(c.id, true)">Reativar</button>
            </li>
          </ul>
        </section>

        <p class="hint">Categoria nunca é apagada: desativada, some da escolha e continua nos gastos que a usam.</p>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonItem, IonPage, IonReorder, IonReorderGroup, actionSheetController, type ReorderEndCustomEvent } from '@ionic/vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { askCategoryName } from '@/components/categoryDialog';
import {
  MAX_CATEGORY_NAME,
  SUGGESTED_CATEGORIES,
  categoryNameProblem,
  categorySections,
  suggestionsToCreate,
  type Category,
} from '@/domain/categories';
import {
  categories,
  createCategories,
  createCategory,
  moveCategory,
  renameCategory,
  setCategoryActive,
  setRequireCategory,
} from '@/services/categories';
import { group } from '@/services/session';

const router = useRouter();

const sections = computed(() => categorySections(categories.value));
const requireOn = computed(() => group.value?.requireCategory === true);
const requireHint = computed(() =>
  requireOn.value
    ? 'Ligada: ao salvar um gasto, abre a janela para escolher a categoria. Vale para os dois.'
    : 'Desligada: os gastos novos ficam "Sem categoria", sem a janela. Vale para os dois.',
);

function onRequire(event: Event): void {
  setRequireCategory((event.target as HTMLInputElement).checked);
}

// ---- Lista sugerida ----
// Descartar vale só neste aparelho (conveniência; some de vez quando houver categorias).
const DISMISS_KEY = 'acerto.categorySuggestionsDismissed';
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
const dismissed = ref(readDismissed());
const suggestions = ref(SUGGESTED_CATEGORIES.map((name) => ({ name, selected: true })));
const toCreate = computed(() => suggestionsToCreate(suggestions.value));
const showSuggestions = computed(() => categories.value.length === 0 && !dismissed.value);

function createSuggested(): void {
  createCategories(toCreate.value);
}

function dismissSuggestions(): void {
  dismissed.value = true;
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Sem armazenamento: as sugestões voltam na próxima vez.
  }
}

// ---- Nova, renomear, reordenar ----
const newName = ref('');
const newError = ref<string | null>(null);

function addNew(): void {
  newError.value = categoryNameProblem(newName.value, categories.value);
  if (newError.value) return;
  createCategory(newName.value);
  newName.value = '';
}

/** Toque no nome: renomear ou desativar (a linha fica só com o nome, as setas e a alça). */
async function openActions(c: Category): Promise<void> {
  const sheet = await actionSheetController.create({
    header: c.name,
    buttons: [
      { text: 'Renomear', handler: () => void rename(c) },
      { text: 'Desativar', handler: () => setCategoryActive(c.id, false) },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function rename(c: Category): Promise<void> {
  const name = await askCategoryName('Renomear categoria', c.name, categories.value, c.id);
  if (name && name !== c.name) renameCategory(c.id, name);
}

function onReorder(event: ReorderEndCustomEvent): void {
  const { from, to } = event.detail;
  // A lista é redesenhada pela nova ordem gravada (o mesmo para os dois).
  event.detail.complete(false);
  if (from !== to) moveCategory(from, to);
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'ajustes' });
}
</script>

<style scoped>
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

.suggestions,
.new {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.suggestions p {
  margin: 0;
}

.suggestions ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.suggestions li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.suggestions .input {
  flex: 1;
  min-width: 0;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.new-row {
  display: flex;
  gap: 8px;
}

.new-row .input {
  flex: 1;
  min-width: 0;
}

.add {
  width: auto;
  flex: none;
  padding: 0 16px;
}

.section-title {
  margin: 8px 0 2px;
  font-size: 15px;
  font-weight: 800;
}

.list {
  padding: 0;
  overflow: hidden;
}

.cat {
  --background: transparent;
  --padding-start: 12px;
  --inner-padding-end: 8px;
  --min-height: 48px;
  border-bottom: 1px solid var(--app-subtle);
}

.cat:last-child {
  border-bottom: 0;
}

.cat-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.plain {
  list-style: none;
  margin: 0;
}

.plain .cat-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-subtle);
}

.plain .cat-row:last-child {
  border-bottom: 0;
}

.name {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: 0;
  padding: 8px 4px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: var(--app-muted);
}

.arrow {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--app-text);
}

.arrow:disabled {
  opacity: 0.3;
}

.handle {
  display: inline-flex;
  width: 32px;
  justify-content: center;
  font-size: 22px;
  color: var(--app-muted);
}
</style>
