<template>
  <ul v-if="rejectedLaunches.length > 0 || itemsAlone.length > 0" class="rejected" role="alert">
    <li v-for="launch in rejectedLaunches" :key="launch.expenseId" class="item">
      <p class="strong">Não foi salvo: {{ launch.kind === 'series' ? 'compra parcelada ' : '' }}{{ expenseLabel(launch.input) }}</p>
      <p class="hint">{{ reason(launch) }}</p>
      <div class="actions">
        <button class="btn outline" type="button" @click="discard(launch)">Descartar</button>
        <button v-if="launch.duplicateOf" class="btn primary" type="button" @click="openDuplicate(launch)">Ver o gasto</button>
        <button v-else-if="launch.kind === 'single'" class="btn primary" type="button" @click="relaunch(launch)">Lançar no mês aberto</button>
      </div>
    </li>
    <li v-for="record in itemsAlone" :key="record.key" class="item">
      <p class="strong">Os itens lidos da nota não foram gravados: {{ record.label }}</p>
      <p class="hint">
        {{ record.items.items.length }} {{ record.items.items.length === 1 ? 'item lido' : 'itens lidos' }} no aparelho. Gravar de novo usa a
        leitura guardada, sem consultar a SEFAZ.
      </p>
      <div class="actions">
        <button class="btn outline" type="button" @click="discardItems(record)">Descartar</button>
        <button class="btn primary" type="button" @click="saveItemsAgain(record)">Tentar gravar de novo</button>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { monthName, monthOf, todayInSaoPaulo } from '@/domain/calendar';
import { createExpense } from '@/services/expenses';
import { duplicateNoteText, expenseLabel } from '@/services/expenseView';
import { forgetLaunch, rejectedLaunches, type RejectedLaunch } from '@/services/launchGuard';
import { forgetItems, rejectedItems, saveItemsAgain, type GuardedItems } from '@/services/itemsGuard';
import { computed } from 'vue';
import { closedMonths } from '@/services/months';
import { firstNameOf, group, user } from '@/services/session';

const router = useRouter();

/**
 * Itens lidos no aparelho que o servidor não tem. Os do lançamento recusado
 * aparecem só no aviso dele: relançar grava os itens junto.
 */
const itemsAlone = computed(() =>
  rejectedItems.value.filter((r) => !rejectedLaunches.value.some((l) => l.groupId === r.groupId && l.expenseId === r.expenseId)),
);

/**
 * Lançamentos recusados na sincronização (o mês fechou enquanto estavam
 * offline): mostra o gasto e oferece relançar com os mesmos dados no mês
 * aberto, mantendo a data. Compra parcelada: só o aviso (relançar mudaria os
 * meses da série). Nota fiscal já lançada: mostra quem lançou e o gasto, sem
 * relançar.
 */

function reason(launch: RejectedLaunch): string {
  const dup = launch.duplicateOf;
  if (dup) {
    return dup.date
      ? `Nota já lançada. ${duplicateNoteText(dup, firstNameOf(dup.createdBy), 'A mesma nota foi lançada')}`
      : 'Nota já lançada em outro gasto.';
  }
  const month = monthName(monthOf(launch.input.date));
  return launch.kind === 'series'
    ? `O mês de ${month} fechou antes de sincronizar. Lance a compra de novo pelo formulário, se precisar.`
    : `O mês de ${month} fechou antes de sincronizar. Relançado, entra no mês aberto, com a mesma data.`;
}

async function relaunch(launch: RejectedLaunch): Promise<void> {
  const uid = user.value?.uid;
  if (!group.value || !uid) return;
  // Mesmos dados; a competência sai do mês aberto (a data fica a original).
  // Os itens lidos no aparelho vão de novo no mesmo lote (sem consultar a SEFAZ).
  createExpense(group.value.id, launch.input, uid, closedMonths.value, todayInSaoPaulo(), launch.photo, launch.deviceItems);
  await forgetLaunch(launch.groupId, launch.expenseId);
}

function discard(launch: RejectedLaunch): void {
  void forgetLaunch(launch.groupId, launch.expenseId);
  if (launch.deviceItems) void forgetItems(launch.groupId, launch.deviceItems.key);
}

function discardItems(record: GuardedItems): void {
  void forgetItems(record.groupId, record.key);
}

/** Abre o gasto que tem a nota; o aviso continua até ser descartado. */
function openDuplicate(launch: RejectedLaunch): void {
  if (launch.duplicateOf) void router.push({ name: 'gasto', params: { id: launch.duplicateOf.expenseId } });
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
