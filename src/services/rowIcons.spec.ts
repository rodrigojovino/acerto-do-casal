import { describe, expect, it } from 'vitest';
import type { Expense } from './expenses';
import { forecastIcons, indicatorOf, originsOf, recurringApprovalIcons, rowIcons } from './rowIcons';

const A = 'uid-a';
const B = 'uid-b';

function expense(overrides: Partial<Expense> & { recurringId?: string } = {}): Expense {
  return {
    id: 'e1', description: 'Mercado', totalCents: 20000, personalCents: 0, payerUid: A, payerSharePct: 50,
    date: '2026-10-05', competence: '2026-10', receipt: { type: 'none' }, status: 'confirmed', createdBy: A,
    createdAt: null, updatedAt: null, pendingWrite: false, ...overrides,
  } as Expense;
}

const key = (entry?: string) => ({ type: 'nfce', nfceKey: '3'.repeat(44), nfceStatus: 'ok', ...(entry ? { entry } : {}) }) as Expense['receipt'];

describe('indicador de situação', () => {
  it('validado (preenchido) × automático (contorno)', () => {
    expect(indicatorOf(expense({ approval: { byUid: B, at: null } }), A, 'Bia').kind).toBe('validated');
    expect(indicatorOf(expense({ receipt: key('qr') }), A, 'Bia').kind).toBe('auto');
    expect(indicatorOf(expense({ approval: { byUid: 'nfce', at: null } }), A, 'Bia').kind).toBe('auto');
  });

  it('ponto azul só quando a próxima ação é de quem vê', () => {
    const pending = expense({ status: 'pending_approval' });
    expect(indicatorOf(pending, A, 'Bia')).toMatchObject({ kind: 'pending', dot: false, label: 'Aguardando aprovação de Bia' });
    expect(indicatorOf(pending, B, 'Ana')).toMatchObject({ kind: 'pending', dot: true, label: 'Aguardando sua aprovação' });
    expect(indicatorOf(expense({ status: 'returned' }), A, 'Bia')).toMatchObject({ kind: 'returned', dot: true });
    expect(indicatorOf(expense({ status: 'returned' }), B, 'Ana')).toMatchObject({ kind: 'returned', dot: false });
    expect(indicatorOf(expense({ status: 'awaiting_confirmation' }), A, 'Bia')).toMatchObject({ kind: 'awaiting', dot: true });
    expect(indicatorOf(expense({ status: 'awaiting_confirmation' }), B, 'Ana')).toMatchObject({ kind: 'awaiting', dot: false });
  });

  it('exclusão pedida vale mais que o status; o ponto é de quem responde', () => {
    const e = expense({ status: 'pending_approval', deletionRequest: { byUid: A, at: null, status: 'pending' } });
    expect(indicatorOf(e, A, 'Bia')).toMatchObject({ kind: 'deletion', dot: false });
    expect(indicatorOf(e, B, 'Ana')).toMatchObject({ kind: 'deletion', dot: true });
    // Recusado: volta ao indicador do status.
    expect(indicatorOf(expense({ deletionRequest: { byUid: A, at: null, status: 'denied' } }), B, 'Ana').kind).toBe('auto');
  });
});

describe('origem', () => {
  it('chave pelo formato lido; os antigos ("lida", sem formato) como QR', () => {
    expect(originsOf(expense({ receipt: key('qr') })).map((o) => o.kind)).toEqual(['qr']);
    expect(originsOf(expense({ receipt: key('barcode') })).map((o) => o.kind)).toEqual(['barcode']);
    expect(originsOf(expense({ receipt: key('typed') })).map((o) => o.kind)).toEqual(['typed']);
    expect(originsOf(expense({ receipt: key('read') })).map((o) => o.kind)).toEqual(['qr']);
    expect(originsOf(expense({ receipt: key() })).map((o) => o.kind)).toEqual(['qr']);
  });

  it('chave com foto mostra os dois; foto sozinha; sem comprovante', () => {
    const withPhoto = { ...key('barcode'), photoPath: 'p', photoUploaded: true } as Expense['receipt'];
    expect(originsOf(expense({ receipt: withPhoto })).map((o) => o.kind)).toEqual(['barcode', 'photo']);
    expect(originsOf(expense({ receipt: { type: 'photo', photoPath: 'p', photoUploaded: true } })).map((o) => o.kind)).toEqual(['photo']);
    expect(originsOf(expense()).map((o) => o.kind)).toEqual(['none']);
  });

  it('recorrente gerado sem comprovante: sem o ícone "sem comprovante"', () => {
    expect(originsOf(expense({ recurringId: 'r1' }))).toEqual([]);
  });
});

describe('rowIcons', () => {
  it('pior caso: chave + foto, recorrente, parcela e divisão (parte de quem vê primeiro)', () => {
    const e = expense({
      receipt: { ...key('qr'), photoPath: 'p', photoUploaded: true } as Expense['receipt'],
      recurringId: 'r1',
      installment: { seriesId: 's', index: 1, count: 12, firstMonth: '2026-10', purchaseCents: 240000 },
      payerSharePct: 70,
      status: 'pending_approval',
    });
    const forA = rowIcons(e, A, 'Bia');
    expect(forA.origins).toHaveLength(2);
    expect(forA.recurring).toBe(true);
    expect(forA.parcel).toEqual({ text: '1/12', label: 'Parcela 1 de 12' });
    expect(forA.split?.text).toBe('70/30');
    expect(rowIcons(e, B, 'Ana').split?.text).toBe('30/70');
    expect(rowIcons(e, B, 'Ana').indicator.dot).toBe(true);
  });

  it('50/50 não mostra a divisão; série resumida em Pendências mostra "12x"', () => {
    const e = expense({ installment: { seriesId: 's', index: 1, count: 12, firstMonth: '2026-10', purchaseCents: 240000 } });
    expect(rowIcons(e, A, 'Bia').split).toBeUndefined();
    expect(rowIcons(e, A, 'Bia', '12x').parcel).toEqual({ text: '12x', label: 'Compra parcelada em 12 vezes' });
  });

  it('previsão e cadastro de recorrente a aprovar', () => {
    expect(forecastIcons()).toMatchObject({ indicator: { kind: 'forecast', dot: false }, recurring: true, origins: [] });
    expect(recurringApprovalIcons(A, B, 'Ana').indicator).toMatchObject({ kind: 'pending', dot: true });
    expect(recurringApprovalIcons(A, A, 'Bia').indicator).toMatchObject({ kind: 'pending', dot: false });
  });
});
