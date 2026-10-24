/**
 * Categorias de gasto, compartilhadas pelo casal. Nunca são apagadas: uma
 * categoria desativada some da escolha e continua nos gastos que já a usam.
 * Gasto sem categoria (os anteriores à v0.8.0, ou com a exigência desligada)
 * aparece como "Sem categoria". A ordem é a mesma para os dois (campo `order`,
 * reordenado em Ajustes) e vale na escolha do gasto e nos filtros.
 */

export interface Category {
  id: string;
  name: string;
  active: boolean;
  /** Posição na lista (0 = primeira); empate, pelo nome. */
  order: number;
}

/** Limite da posição (o mesmo das regras). */
export const MAX_CATEGORY_ORDER = 9999;

/** Limite do nome (o mesmo das regras). */
export const MAX_CATEGORY_NAME = 40;

export const NO_CATEGORY_LABEL = 'Sem categoria';

/** Lista inicial sugerida, oferecida enquanto o grupo não tem nenhuma categoria. */
export const SUGGESTED_CATEGORIES: readonly string[] = [
  'Mercado',
  'Contas da casa',
  'Restaurantes',
  'Saúde',
  'Transporte',
  'Lazer',
  'Casa',
];

/** Nome gravado: sem espaços nas pontas nem repetidos, no limite. */
export function cleanCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_CATEGORY_NAME);
}

/** Forma de comparação: sem diferenciar maiúsculas nem acentos. */
export function categoryKey(name: string): string {
  return cleanCategoryName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR');
}

/**
 * Problema com o nome digitado (vazio ou repetido), ou null se pode salvar.
 * `exceptId`: a própria categoria, ao renomear. Desativadas também contam:
 * para usar o nome de novo, reativa-se a antiga.
 */
export function categoryNameProblem(
  name: string,
  categories: readonly Category[],
  exceptId?: string,
): string | null {
  const clean = cleanCategoryName(name);
  if (!clean) return 'Informe o nome da categoria.';
  const key = categoryKey(clean);
  const same = categories.find((c) => c.id !== exceptId && categoryKey(c.name) === key);
  if (!same) return null;
  return same.active ? `Já existe a categoria "${same.name}".` : `Já existe a categoria "${same.name}", desativada: reative-a.`;
}

/** Ordem do casal; empate (ex.: criadas ao mesmo tempo pelos dois), pelo nome. */
export function sortCategories<C extends Pick<Category, 'name' | 'order'>>(list: readonly C[]): C[] {
  return [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

/** Ajustes: ativas em ordem e, numa seção abaixo, as desativadas. */
export function categorySections(categories: readonly Category[]): { active: Category[]; inactive: Category[] } {
  const sorted = sortCategories(categories);
  return { active: sorted.filter((c) => c.active), inactive: sorted.filter((c) => !c.active) };
}

/** As que aparecem na escolha do gasto: ativas, em ordem; mais a atual, se desativada (para não sumir na edição). */
export function choosableCategories(categories: readonly Category[], currentId?: string): Category[] {
  const sorted = sortCategories(categories.filter((c) => c.active));
  const current = categories.find((c) => c.id === currentId && !c.active);
  return current ? [...sorted, current] : sorted;
}

/** Posição de uma categoria nova: no fim da lista. */
export function nextCategoryOrder(categories: readonly Pick<Category, 'order'>[]): number {
  return Math.min(MAX_CATEGORY_ORDER, categories.reduce((max, c) => Math.max(max, c.order + 1), 0));
}

/**
 * Move uma categoria ativa de `from` para `to` (índices na lista de ativas) e
 * devolve só as posições que mudam, para gravar num lote. As ativas ficam
 * numeradas 0..n-1 na nova ordem; as desativadas não mudam.
 */
export function reorderCategories(
  categories: readonly Category[],
  from: number,
  to: number,
): Array<{ id: string; order: number }> {
  const list = categorySections(categories).active;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list.flatMap((c, i) => (c.order === i ? [] : [{ id: c.id, order: i }]));
}

/** Nome para exibir: a categoria, "Sem categoria" ou, se ainda não chegou ao aparelho, "Categoria". */
export function categoryLabel(categoryId: string | undefined, categories: readonly Category[]): string {
  if (!categoryId) return NO_CATEGORY_LABEL;
  return categories.find((c) => c.id === categoryId)?.name ?? 'Categoria';
}

/**
 * Sugestões a criar: os nomes marcados, limpos, sem vazios nem repetidos
 * entre si (a lista só é oferecida quando o grupo ainda não tem categorias).
 */
export function suggestionsToCreate(choices: ReadonlyArray<{ name: string; selected: boolean }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of choices) {
    const name = cleanCategoryName(c.name);
    const key = categoryKey(name);
    if (!c.selected || !name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
