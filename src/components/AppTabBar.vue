<template>
  <nav class="tabbar" aria-label="Navegação principal">
    <router-link :to="{ name: 'painel' }" class="tab" :class="{ active: active === 'painel' }" :aria-current="active === 'painel' ? 'page' : undefined">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
      Início
    </router-link>
    <router-link :to="{ name: 'pendencias' }" class="tab" :class="{ active: active === 'pendencias' }" :aria-current="active === 'pendencias' ? 'page' : undefined">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      Pendências
    </router-link>
    <router-link :to="{ name: 'gasto-novo' }" class="add" aria-label="Novo gasto">
      <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </router-link>
    <router-link :to="{ name: 'historico' }" class="tab" :class="{ active: active === 'historico' }" :aria-current="active === 'historico' ? 'page' : undefined">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
      Histórico
    </router-link>
    <router-link :to="{ name: 'ajustes' }" class="tab" :class="{ active: active === 'ajustes' }" :aria-current="active === 'ajustes' ? 'page' : undefined">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
      Ajustes
    </router-link>
  </nav>
</template>

<script setup lang="ts">
defineProps<{ active: 'painel' | 'pendencias' | 'historico' | 'ajustes' }>();
</script>

<style scoped>
.tabbar {
  height: 68px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--app-surface);
  border-top: 1px solid var(--app-border);
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
}

.tab {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--app-muted);
  text-decoration: none;
}

.tab.active {
  font-weight: 700;
  color: var(--app-accent);
}

.add {
  justify-self: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--app-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab:focus-visible,
.add:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}
</style>
