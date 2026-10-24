import { cleanCategoryName } from '@/domain/categories';

/**
 * Montagem dos documentos de categoria (`groups/{g}/categories/{id}`) e da
 * exigência de categoria no grupo, exatamente como são gravados. Sem
 * dependência do SDK (horário do servidor por parâmetro), para os testes de
 * regras usarem as mesmas funções. Categoria nunca é apagada: só desativada.
 */

/** `order`: posição na lista (categoria nova vai para o fim, `nextCategoryOrder`). */
export function newCategoryData<T>(name: string, order: number, uid: string, now: T) {
  return { name: cleanCategoryName(name), active: true, order, createdBy: uid, createdAt: now, updatedAt: now };
}

export function categoryRenameData<T>(name: string, now: T) {
  return { name: cleanCategoryName(name), updatedAt: now };
}

/** Nova posição (reordenar: as que mudam, num lote, `reorderCategories`). */
export function categoryOrderData<T>(order: number, now: T) {
  return { order, updatedAt: now };
}

/** Desativar (some da escolha; os gastos que a usam continuam com ela) ou reativar. */
export function categoryActiveData<T>(active: boolean, now: T) {
  return { active, updatedAt: now };
}

/** "Exigir categoria nos gastos", no documento do grupo (qualquer membro muda). */
export function requireCategoryData(requireCategory: boolean) {
  return { requireCategory };
}
