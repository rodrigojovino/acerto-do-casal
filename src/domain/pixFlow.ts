/**
 * Registro do pagamento por PIX (v0.9.3), como sequência pura: escolher a foto
 * do comprovante → confirmar numa prévia ("Registrar pagamento de R$ X com este
 * comprovante?") → enviar a foto e registrar. Nada vai para o Storage antes de
 * "Registrar". Se o valor que falta mudou entre a confirmação e o registro, a
 * Function recusa: a prévia volta com o novo valor para confirmar de novo, com
 * a mesma foto (já enviada, não sobe de novo).
 */

export type PixState =
  | { kind: 'idle' }
  | { kind: 'confirming'; amountCents: number; uploaded: boolean; changedFrom?: number }
  | { kind: 'sending'; amountCents: number; uploaded: boolean };

export type PixEvent =
  | { type: 'photo'; amountCents: number }
  | { type: 'register' }
  | { type: 'uploaded' }
  | { type: 'amountChanged'; amountCents: number }
  | { type: 'failed' }
  | { type: 'done' }
  | { type: 'change' }
  | { type: 'close' };

export const PIX_IDLE: PixState = { kind: 'idle' };

export function pixStep(state: PixState, event: PixEvent): PixState {
  switch (event.type) {
    case 'photo':
      // Foto nova (também depois de "Trocar foto"): nada enviado ainda.
      return { kind: 'confirming', amountCents: event.amountCents, uploaded: false };
    case 'register':
      return state.kind === 'confirming' ? { kind: 'sending', amountCents: state.amountCents, uploaded: state.uploaded } : state;
    case 'uploaded':
      return state.kind === 'sending' ? { ...state, uploaded: true } : state;
    case 'amountChanged':
      // Mesma foto (e mesmo envio): só o valor muda, para confirmar de novo.
      return state.kind === 'sending'
        ? { kind: 'confirming', amountCents: event.amountCents, uploaded: state.uploaded, changedFrom: state.amountCents }
        : state;
    case 'failed':
      return state.kind === 'sending' ? { kind: 'confirming', amountCents: state.amountCents, uploaded: state.uploaded } : state;
    case 'done':
    case 'change':
    case 'close':
      return PIX_IDLE;
  }
}

/** A foto só sobe depois de "Registrar", e uma vez só. */
export function mayUpload(state: PixState): boolean {
  return state.kind === 'sending' && !state.uploaded;
}
