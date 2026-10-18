import { describe, expect, it } from 'vitest';
import { historyRow } from './historyView';

const A = 'uid-a';
const B = 'uid-b';
const nameOf = (uid: string) => (uid === A ? 'Ana' : 'Bia');

describe('historyRow', () => {
  it('mês sem documento: aberto, ou em andamento se for o atual', () => {
    expect(historyRow(null, '2026-09', '2026-10', A, nameOf)).toMatchObject({ state: 'open', stateLabel: 'Aberto', result: null });
    expect(historyRow(null, '2026-10', '2026-10', A, nameOf)).toMatchObject({ state: 'current', stateLabel: 'Em andamento' });
  });

  it('fechado: resultado do ponto de vista de quem olha e a forma do pagamento', () => {
    const doc = {
      status: 'closed' as const,
      summary: { result: { fromUid: A, toUid: B, amountCents: 10000 } },
      payments: [{ method: 'pix' as const }],
    };
    expect(historyRow(doc, '2026-09', '2026-10', A, nameOf)).toMatchObject({
      state: 'closed',
      stateLabel: 'Fechado',
      method: 'PIX',
    });
    expect(historyRow(doc, '2026-09', '2026-10', A, nameOf).result).toMatch(/^Você pagou R\$\s100,00 a Bia$/);
    expect(historyRow(doc, '2026-09', '2026-10', B, nameOf).result).toMatch(/^Ana pagou R\$\s100,00 a você$/);
    expect(historyRow({ ...doc, payments: [{ method: 'pix' }, { method: 'cash' }] }, '2026-09', '2026-10', A, nameOf).method).toBe(
      'PIX e dinheiro',
    );
  });

  it('fechado sem acerto e com pedido de reabertura pendente', () => {
    const row = historyRow(
      { status: 'closed', summary: { result: null }, payments: [], reopenRequest: { status: 'pending' } },
      '2026-09',
      '2026-10',
      A,
      nameOf,
    );
    expect(row).toMatchObject({ result: 'Ninguém devia nada', method: null, reopenPending: true });
  });

  it('reaberto: aberto que já foi fechado', () => {
    expect(historyRow({ status: 'open', payments: [{ method: 'cash' }] }, '2026-09', '2026-10', A, nameOf).state).toBe('reopened');
    expect(
      historyRow({ status: 'open', payments: [], reopenRequest: { status: 'approved' } }, '2026-09', '2026-10', A, nameOf).stateLabel,
    ).toBe('Reaberto');
  });
});
