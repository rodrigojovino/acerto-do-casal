import { describe, expect, it } from 'vitest';
import { collapseSeries, seriesTargets, type SeriesParcel } from './series';

const A = 'uid-a';
const B = 'uid-b';

function parcel(index: number, overrides: Partial<SeriesParcel> = {}): SeriesParcel {
  return {
    id: index === 1 ? 's1' : `s1-${index}`,
    competence: `2026-${String(8 + index).padStart(2, '0')}`,
    status: 'pending_approval',
    createdBy: A,
    installment: { seriesId: 's1', index, count: 4, firstMonth: '2026-09', purchaseCents: 40000 },
    ...overrides,
  };
}

describe('seriesTargets', () => {
  const closed = new Set(['2026-09']); // parcela 1 em mês fechado

  it('aprovar/recusar: todas as pendentes de meses abertos, só pelo outro membro', () => {
    const series = [parcel(3), parcel(1), parcel(2), parcel(4)];
    expect(seriesTargets(series, 'approve', B, closed).map((p) => p.id)).toEqual(['s1-2', 's1-3', 's1-4']);
    expect(seriesTargets(series, 'reject', B, closed)).toHaveLength(3);
    expect(seriesTargets(series, 'approve', A, closed)).toEqual([]);
  });

  it('contestar uma parcela contesta a série inteira (as confirmadas automaticamente de meses abertos)', () => {
    const series = [1, 2, 3, 4].map((i) => parcel(i, { status: 'confirmed' }));
    series[3] = parcel(4, { status: 'confirmed', approval: { byUid: B } }); // já validada: não é contestável
    expect(seriesTargets(series, 'contest', B, closed).map((p) => p.id)).toEqual(['s1-2', 's1-3']);
    expect(seriesTargets(series, 'validate', B, new Set()).map((p) => p.id)).toEqual(['s1', 's1-2', 's1-3']);
  });

  it('editar e excluir: todas as de meses abertos, só quem lançou', () => {
    const series = [1, 2, 3, 4].map((i) => parcel(i, { status: i % 2 ? 'confirmed' : 'returned' }));
    expect(seriesTargets(series, 'edit', A, closed)).toHaveLength(3);
    expect(seriesTargets(series, 'delete', A, new Set())).toHaveLength(4);
    expect(seriesTargets(series, 'edit', B, closed)).toEqual([]);
  });
});

describe('collapseSeries', () => {
  it('uma linha por série (a menor parcela), com o tamanho; gasto avulso fica como está', () => {
    const avulso = { id: 'x' };
    const rows = collapseSeries([parcel(3), avulso, parcel(2), parcel(4)]);
    expect(rows.map((r) => [r.id, r.seriesSize])).toEqual([
      ['s1-2', 3],
      ['x', 1],
    ]);
  });
});
