<template>
  <div class="sync" aria-live="polite">
    <span v-if="!isOnline" class="pill offline">
      <span class="dot" aria-hidden="true"></span>Sem conexão · os lançamentos ficam salvos no aparelho
    </span>
    <span v-else-if="syncing" class="pill syncing">
      <span class="dot" aria-hidden="true"></span>Sincronizando…
    </span>
    <RejectedLaunches />
    <p v-if="writeError" class="alert-error error" role="alert">
      <span>{{ writeError }}</span>
      <button class="link" type="button" @click="clearWriteError">Ok</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { clearWriteError, isOnline, isSyncing, writeError } from '@/services/sync';
import RejectedLaunches from './RejectedLaunches.vue';

const props = defineProps<{
  /** Há gravações deste mês ainda não confirmadas pelo servidor (vindas do cache). */
  pendingWrites?: boolean;
}>();

const syncing = computed(() => isSyncing.value || props.pendingWrites === true);
</script>

<style scoped>
.sync {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sync:empty {
  display: none;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.offline {
  background: var(--app-subtle);
  color: #3f3f3b;
}

.syncing {
  background: #e3eafa;
  color: var(--app-accent-dark);
}

.syncing .dot {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .syncing .dot {
    animation: none;
  }
}

.error {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.error .link {
  color: var(--app-danger);
}
</style>
