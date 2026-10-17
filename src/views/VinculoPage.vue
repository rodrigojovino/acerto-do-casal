<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="top">
          <div>
            <p class="hello">Olá, {{ firstName }}</p>
            <h1>Vincule o casal</h1>
          </div>
          <button class="link" type="button" @click="sair">Sair</button>
        </header>

        <p class="lead">Um de vocês cria o grupo e envia o código. O outro digita o código abaixo.</p>

        <section class="card" aria-labelledby="titulo-convite">
          <h2 id="titulo-convite">Seu código de convite</h2>

          <template v-if="inviteCode">
            <div class="code-row">
              <output class="code" :class="{ expired }" aria-live="polite">{{ inviteCode }}</output>
              <button class="btn primary" type="button" :disabled="expired" @click="enviar">Enviar</button>
            </div>
            <p v-if="expired" class="hint warn">Este código expirou. Gere um novo para enviar.</p>
            <p v-else class="hint">Vale até {{ validUntil }}. Assim que a outra pessoa entrar, o app abre o painel.</p>
            <button class="link" type="button" :disabled="!!busy" @click="renovar">
              {{ busy === 'renew' ? 'Gerando…' : 'Gerar novo código' }}
            </button>
          </template>

          <template v-else>
            <p class="hint">Só um de vocês cria o grupo. Se a outra pessoa já tem um código, use o campo abaixo.</p>
            <button class="btn primary wide" type="button" :disabled="!!busy" @click="criar">
              {{ busy === 'create' ? 'Criando…' : 'Criar grupo e gerar código' }}
            </button>
          </template>

          <p v-if="notice" class="hint ok" role="status">{{ notice }}</p>
        </section>

        <section class="card" aria-labelledby="titulo-entrar">
          <h2 id="titulo-entrar">Recebeu um código?</h2>
          <form class="code-row" @submit.prevent="entrar">
            <label class="sr-only" for="codigo">Código de convite</label>
            <input
              id="codigo"
              v-model="typed"
              class="input"
              placeholder="Digite o código"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="9"
              :disabled="!!busy"
            />
            <button class="btn outline" type="submit" :disabled="!!busy || typedClean.length < 6">
              {{ busy === 'join' ? 'Entrando…' : 'Entrar' }}
            </button>
          </form>
          <p v-if="inviteCode" class="hint">Se vocês dois criaram grupo, quem digitar o código do outro entra no grupo dele, e o próprio código deixa de valer.</p>
        </section>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <p class="footnote">O grupo aceita exatamente 2 pessoas.</p>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { signOut } from '@/services/auth';
import { GroupError, createGroup, joinGroup, renewInvite } from '@/services/group';
import { group, user } from '@/services/session';
import { shareText } from '@/services/share';

type Busy = 'create' | 'renew' | 'join' | null;

const busy = ref<Busy>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const typed = ref('');

const firstName = computed(() => user.value?.displayName?.split(' ')[0] ?? 'tudo bem?');

// O código vem do documento do grupo (atualiza sozinho ao renovar).
const inviteCode = computed(() => {
  const code = group.value?.inviteCode;
  return code ? `${code.slice(0, 3)}-${code.slice(3)}` : null;
});

// Relógio para marcar o código como expirado sem precisar recarregar.
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => window.clearInterval(timer));

const expiresAt = computed(() => group.value?.inviteExpiresAt?.toMillis() ?? null);
const expired = computed(() => expiresAt.value !== null && expiresAt.value <= now.value);

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const validUntil = computed(() =>
  expiresAt.value ? dateFormat.format(new Date(expiresAt.value)).replace(', ', ' às ') : '',
);

const typedClean = computed(() => typed.value.toUpperCase().replace(/[\s-]/g, ''));

async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  notice.value = null;
  busy.value = kind;
  try {
    await action();
  } catch (err) {
    error.value = err instanceof GroupError ? err.message : 'Algo deu errado. Tente de novo.';
  } finally {
    busy.value = null;
  }
}

function criar(): Promise<void> {
  return run('create', createGroup);
}

function renovar(): Promise<void> {
  return run('renew', renewInvite);
}

// Ao entrar, o grupo passa a ter 2 membros e a guarda de rota abre o painel.
function entrar(): Promise<void> {
  return run('join', () => joinGroup(typedClean.value));
}

async function enviar(): Promise<void> {
  if (!inviteCode.value) return;
  notice.value = null;
  const text =
    `Vamos acertar as contas no Acerto do Casal? Entre com sua conta Google ` +
    `e digite o código ${inviteCode.value} (vale até ${validUntil.value}).`;
  const outcome = await shareText(text);
  if (outcome === 'copied') notice.value = 'Código copiado. Cole na conversa com a outra pessoa.';
  if (outcome === 'failed') notice.value = `Não deu para compartilhar. Envie o código ${inviteCode.value}.`;
}

async function sair(): Promise<void> {
  await signOut();
}
</script>

<style scoped>
.screen {
  min-height: 100%;
  box-sizing: border-box;
  max-width: 480px;
  margin: 0 auto;
  padding: calc(32px + env(safe-area-inset-top, 0px)) 20px calc(28px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hello {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-muted);
}

h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.4px;
}

h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--app-muted);
}

.lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--app-muted);
}

.card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.code-row {
  display: flex;
  gap: 8px;
}

.code {
  flex: 1;
  min-width: 0;
  height: 52px;
  border-radius: var(--app-radius-control);
  background: var(--app-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 3px;
  font-variant-numeric: tabular-nums;
}

.code.expired {
  color: var(--app-muted);
  text-decoration: line-through;
}

.input {
  flex: 1;
  min-width: 0;
  height: 48px;
  box-sizing: border-box;
  border-radius: var(--app-radius-control);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  padding: 0 14px;
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--app-text);
}

.input::placeholder {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--app-muted);
}

.btn {
  height: 48px;
  padding: 0 18px;
  border-radius: var(--app-radius-control);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.btn.primary {
  border: 0;
  background: var(--app-accent);
  color: #fff;
}

.btn.primary:active {
  background: var(--app-accent-dark);
}

.btn.outline {
  border: 1px solid var(--app-text);
  background: var(--app-surface);
  color: var(--app-text);
}

.btn.wide {
  height: 52px;
  border-radius: var(--app-radius-button);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn:focus-visible,
.input:focus-visible,
.link:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.link {
  align-self: flex-start;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  color: var(--app-accent);
  cursor: pointer;
}

.link:disabled {
  opacity: 0.5;
}

.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--app-muted);
}

.hint.warn {
  color: #8a3f00;
  font-weight: 600;
}

.hint.ok {
  color: #1e6b3a;
  font-weight: 600;
}

.error {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  background: var(--app-danger-bg);
  color: var(--app-danger);
  font-size: 14px;
  font-weight: 600;
}

.footnote {
  margin: auto 0 0;
  padding-top: 8px;
  font-size: 12px;
  color: var(--app-muted);
  text-align: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
