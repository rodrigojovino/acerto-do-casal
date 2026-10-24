import { describe, expect, it } from 'vitest';
import {
  MAX_CATEGORY_NAME,
  categoryLabel,
  categoryNameProblem,
  categorySections,
  choosableCategories,
  cleanCategoryName,
  nextCategoryOrder,
  reorderCategories,
  sortCategories,
  suggestionsToCreate,
  type Category,
} from './categories';

const list: Category[] = [
  { id: 'c1', name: 'Mercado', active: true, order: 0 },
  { id: 'c2', name: 'Saúde', active: true, order: 1 },
  { id: 'c3', name: 'Academia', active: false, order: 2 },
];

describe('cleanCategoryName', () => {
  it('tira espaços das pontas e repetidos e corta no limite', () => {
    expect(cleanCategoryName('  Contas   da  casa ')).toBe('Contas da casa');
    expect(cleanCategoryName('x'.repeat(60))).toHaveLength(MAX_CATEGORY_NAME);
  });
});

describe('categoryNameProblem', () => {
  it('vazio', () => {
    expect(categoryNameProblem('   ', list)).toBe('Informe o nome da categoria.');
  });

  it('repetido sem diferenciar maiúsculas nem acentos', () => {
    expect(categoryNameProblem('saude', list)).toBe('Já existe a categoria "Saúde".');
    expect(categoryNameProblem(' MERCADO ', list)).toBe('Já existe a categoria "Mercado".');
  });

  it('repetido de uma desativada: pede para reativar', () => {
    expect(categoryNameProblem('academia', list)).toBe('Já existe a categoria "Academia", desativada: reative-a.');
  });

  it('renomear a própria (só maiúsculas) não conta como repetido', () => {
    expect(categoryNameProblem('mercado', list, 'c1')).toBeNull();
    expect(categoryNameProblem('Lazer', list)).toBeNull();
  });
});

describe('ordem', () => {
  it('pela posição do casal; empate pelo nome, em português', () => {
    const sorted = sortCategories([
      { name: 'Saúde', order: 1 },
      { name: 'Óculos', order: 0 },
      { name: 'casa', order: 2 },
      { name: 'Bar', order: 2 },
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['Óculos', 'Saúde', 'Bar', 'casa']);
  });

  it('seções: ativas em ordem e desativadas abaixo', () => {
    const s = categorySections([...list, { id: 'c4', name: 'Bar', active: true, order: 5 }]);
    expect(s.active.map((c) => c.id)).toEqual(['c1', 'c2', 'c4']);
    expect(s.inactive.map((c) => c.id)).toEqual(['c3']);
  });

  it('categoria nova vai para o fim (contando as desativadas)', () => {
    expect(nextCategoryOrder(list)).toBe(3);
    expect(nextCategoryOrder([])).toBe(0);
  });

  it('mover devolve só as posições que mudam, entre as ativas', () => {
    const four: Category[] = [
      { id: 'a', name: 'A', active: true, order: 0 },
      { id: 'b', name: 'B', active: true, order: 1 },
      { id: 'x', name: 'X', active: false, order: 2 },
      { id: 'c', name: 'C', active: true, order: 3 },
    ];
    expect(reorderCategories(four, 2, 0)).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ]);
    expect(reorderCategories(four, 0, 1)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
      { id: 'c', order: 2 },
    ]);
    expect(reorderCategories(four, 1, 1)).toEqual([]);
    expect(reorderCategories(four, 0, 5)).toEqual([]);
  });
});

describe('escolha e exibição', () => {
  it('só ativas, na ordem do casal, mais a atual desativada no fim', () => {
    expect(choosableCategories(list).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(choosableCategories(list, 'c3').map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('rótulo: nome, sem categoria, ou genérico enquanto a categoria não chegou', () => {
    expect(categoryLabel('c2', list)).toBe('Saúde');
    expect(categoryLabel(undefined, list)).toBe('Sem categoria');
    expect(categoryLabel('c9', list)).toBe('Categoria');
  });
});

describe('suggestionsToCreate', () => {
  it('só as marcadas, com o nome editado, sem vazias nem repetidas', () => {
    expect(
      suggestionsToCreate([
        { name: 'Mercado', selected: true },
        { name: 'Restaurantes', selected: false },
        { name: '  Farmácia ', selected: true },
        { name: '', selected: true },
        { name: 'mercado', selected: true },
      ]),
    ).toEqual(['Mercado', 'Farmácia']);
  });
});
