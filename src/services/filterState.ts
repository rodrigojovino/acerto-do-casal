import { ref } from 'vue';
import { emptyFilters, type ExpenseFilters } from './expenseFilters';

/**
 * Filtros do Painel: continuam ao trocar de mês, até serem limpos. Só na
 * memória: fechar o app os limpa (de propósito, nada fica guardado no aparelho).
 */
export const painelFilters = ref<ExpenseFilters>(emptyFilters());

export function clearPainelFilters(): void {
  painelFilters.value = emptyFilters();
}
