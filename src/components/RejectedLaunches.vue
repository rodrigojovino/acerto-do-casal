<template>
  <ul v-if="rejectedLaunches.length > 0" class="rejected" role="alert">
    <li v-for="launch in rejectedLaunches" :key="launch.expenseId" class="item">
      <p class="strong">Não foi salvo: {{ launch.kind === 'series' ? 'compra parcelada ' : '' }}{{ expenseLabel(launch.input) }}</p>
      <p class="hint">{{ reason(launch) }}</p>
      <div class="actions">
        <button class="btn outline" type="button" @click="discard(launch)">Descartar</button>
        <button v-if="launch.kind === 'single'" class="btn primary" type="button" @click="relaunch(launch)">Lançar no mês aberto</button>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { monthName, monthOf, todayInSaoPaulo } from '@/domain/calendar';
import { createExpense } from '@/services/expenses';
import { expenseLabel } from '@/services/expenseView';
import { forgetLaunch, rejectedLaunches, type GuardedLaunch } from '@/services/launchGuard';
import { closedMonths } from '@/services/months';
import { group, user } from '@/services/session';

/**
 * Lançamentos recusados na sincronização (o mês fechou enquanto estavam
 * offline): mostra o gasto e oferece relançar com os mesmos dados no mês
 * aberto, mantendo a data. Compra parcelada: só o aviso (relançar mudaria os
 * meses da série).
 */

function reason(launch: GuardedLaunch): string {
  const month = monthName(monthOf(launch.input.date));
  return launch.kind === 'series'
    ? `O mês de ${month} fechou antes de sincronizar. Lance a compra de novo pelo formulário, se precisar.`
    : `O mês de ${month} fechou antes de sincronizar. Relançado, entra no mês aberto, com a mesma data.`;
}

async function relaunch(launch: GuardedLaunch): Promise<void> {
  const uid = user.value?.uid;
  if (!group.value || !uid) return;
  // Mesmos dados; a competência sai do mês aberto (a data fica a original).
  createExpense(group.value.id, launch.input, uid, closedMonths.value, todayInSaoPaulo(), launch.photo);
  await forgetLaunch(launch.groupId, launch.expenseId);
}

function discard(launch: GuardedLaunch): void {
  void forgetLaunch(launch.groupId, launch.expenseId);
}
</script>

<style scoped>
.rejected {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  background: var(--app-danger-bg);
  color: var(--app-danger);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item p {
  margin: 0;
}

.item .hint {
  color: inherit;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.actions .btn {
  height: 40px;
  font-size: 14px;
}

.strong {
  font-weight: 700;
}
</style>
