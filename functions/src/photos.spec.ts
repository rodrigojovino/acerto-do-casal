import { describe, expect, it } from 'vitest';
import { expensePhotoPath, monthPhotoPaths, orphanPhotos, photoKind, type StoredFile } from './photos';

// Caminhos fictícios, no formato do app.
const NOW = new Date('2026-10-25T07:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const file = (path: string, age: number, size = 1000): StoredFile => ({ path, updated: daysAgo(age), size });

describe('photoKind', () => {
  it('só as pastas de comprovante', () => {
    expect(photoKind('groups/g1/receipts/e1.jpg')).toBe('receipt');
    expect(photoKind('groups/g1/settlements/2026-10/p1.jpg')).toBe('settlement');
    expect(photoKind('groups/g1/outra/e1.jpg')).toBeNull();
    expect(photoKind('groups/g1/receipts/sub/e1.jpg')).toBeNull();
    expect(photoKind('groups/g1/receipts/e1.png')).toBeNull();
  });
});

describe('referências', () => {
  it('foto do gasto: de recibo ou da nota junto com a chave', () => {
    expect(expensePhotoPath({ receipt: { photoPath: 'groups/g1/receipts/e1.jpg' } })).toBe('groups/g1/receipts/e1.jpg');
    expect(expensePhotoPath({ receipt: {} })).toBeNull();
    expect(expensePhotoPath({})).toBeNull();
  });

  it('comprovantes PIX só dos pagamentos registrados', () => {
    const month = { payments: [{ receiptPath: 'groups/g1/settlements/2026-10/p1.jpg' }, { method: 'cash' }, null] };
    expect(monthPhotoPaths(month)).toEqual(['groups/g1/settlements/2026-10/p1.jpg']);
    expect(monthPhotoPaths({})).toEqual([]);
  });
});

describe('orphanPhotos', () => {
  const files = [
    file('groups/g1/receipts/usada.jpg', 30),
    file('groups/g1/receipts/orfa.jpg', 8, 2500),
    file('groups/g1/receipts/orfa-recente.jpg', 2),
    file('groups/g1/settlements/2026-10/pago.jpg', 30),
    file('groups/g1/settlements/2026-10/sem-pagamento.jpg', 10, 500),
    file('groups/g1/outra-coisa.txt', 30),
  ];
  const referenced = new Set(['groups/g1/receipts/usada.jpg', 'groups/g1/settlements/2026-10/pago.jpg']);

  it('apaga só o que ninguém usa e passou do prazo de 7 dias', () => {
    const r = orphanPhotos(files, referenced, NOW);
    expect(r.orphans.map((f) => f.path)).toEqual(['groups/g1/receipts/orfa.jpg', 'groups/g1/settlements/2026-10/sem-pagamento.jpg']);
    expect(r).toMatchObject({ files: 5, referenced: 2, recent: 1, byKind: { receipt: 1, settlement: 1 }, orphanBytes: 3000 });
  });

  it('referenciada nunca sai, por mais antiga que seja; o prazo conta da última gravação', () => {
    expect(orphanPhotos([file('groups/g1/receipts/usada.jpg', 400)], referenced, NOW).orphans).toEqual([]);
    expect(orphanPhotos([file('groups/g1/receipts/x.jpg', 7)], new Set(), NOW).orphans).toHaveLength(1);
    expect(orphanPhotos([file('groups/g1/receipts/x.jpg', 6.9)], new Set(), NOW).recent).toBe(1);
  });
});
