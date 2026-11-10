import { describe, expect, it } from 'vitest';
import { CANCEL_REFUSAL_TEXT, paymentCancelRefusal } from './closing';
import { paymentCancelledNotice } from './notifications';

// Cancelar um pagamento do acerto (v0.9.3). UIDs fictícios: A pagou e registrou, B recebe.
const A = 'uid-a';
const B = 'uid-b';
const T = Date.UTC(2026, 10, 10, 22, 49);

describe('quem pode cancelar um pagamento', () => {
  const pay = { byUid: A, atMs: T };

  it('quem registrou, com o mês aberto e sem reabertura: pode', () => {
    expect(paymentCancelRefusal({ status: 'open' }, pay, A)).toBeNull();
  });

  it('quem recebe (ou um terceiro) não cancela o pagamento de quem pagou', () => {
    expect(paymentCancelRefusal({ status: 'open' }, pay, B)).toBe('not_yours');
    expect(paymentCancelRefusal({ status: 'open' }, pay, 'uid-c')).toBe('not_yours');
  });

  it('mês fechado: recusa, com o motivo claro', () => {
    expect(paymentCancelRefusal({ status: 'closed' }, pay, A)).toBe('closed');
    expect(CANCEL_REFUSAL_TEXT.closed).toMatch(/fechado/);
  });

  it('mês reaberto: o pagamento de antes da reabertura é do fechamento anterior; o de depois pode', () => {
    expect(paymentCancelRefusal({ status: 'open', reopenedAtMs: T + 1 }, pay, A)).toBe('previous_closing');
    expect(paymentCancelRefusal({ status: 'open', reopenedAtMs: T }, pay, A)).toBe('previous_closing');
    expect(paymentCancelRefusal({ status: 'open', reopenedAtMs: T - 1 }, pay, A)).toBeNull();
  });

  it('pagamento que não está mais na lista', () => {
    expect(paymentCancelRefusal({ status: 'open' }, undefined, A)).toBe('not_found');
  });
});

describe('aviso do cancelamento', () => {
  it('para o outro membro, na categoria Acerto e fechamento, com o valor e o dia do registro', () => {
    const notice = paymentCancelledNotice({ amountCents: 61178, byUid: A, atMs: T }, '2026-10', {
      members: [A, B],
      nameOf: (uid) => (uid === A ? 'Rodrigo' : 'Queila'),
    });
    expect(notice).toEqual({
      toUid: B,
      category: 'settlement',
      title: 'Pagamento cancelado',
      body: 'Rodrigo cancelou o pagamento de R$ 611,78 registrado em 10/11',
      route: '/fechar/2026-10',
    });
  });
});
