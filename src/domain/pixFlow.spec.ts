import { describe, expect, it } from 'vitest';
import { PIX_IDLE, mayUpload, pixStep, type PixEvent, type PixState } from './pixFlow';

const run = (events: PixEvent[], from: PixState = PIX_IDLE) => events.reduce(pixStep, from);

describe('registro do PIX com confirmação', () => {
  it('escolher a foto só abre a prévia: nada é enviado antes de "Registrar"', () => {
    const s = run([{ type: 'photo', amountCents: 61178 }]);
    expect(s).toEqual({ kind: 'confirming', amountCents: 61178, uploaded: false });
    expect(mayUpload(s)).toBe(false);
  });

  it('"Trocar foto" e fechar não enviam nada', () => {
    expect(run([{ type: 'photo', amountCents: 100 }, { type: 'change' }])).toEqual(PIX_IDLE);
    expect(run([{ type: 'photo', amountCents: 100 }, { type: 'close' }])).toEqual(PIX_IDLE);
    expect(mayUpload(run([{ type: 'photo', amountCents: 100 }, { type: 'close' }]))).toBe(false);
  });

  it('"Registrar" libera o envio uma vez só', () => {
    const sending = run([{ type: 'photo', amountCents: 100 }, { type: 'register' }]);
    expect(mayUpload(sending)).toBe(true);
    expect(mayUpload(pixStep(sending, { type: 'uploaded' }))).toBe(false);
  });

  it('valor mudou antes do registro: volta à prévia com o novo valor e a mesma foto (não sobe de novo)', () => {
    const s = run([{ type: 'photo', amountCents: 61178 }, { type: 'register' }, { type: 'uploaded' }, { type: 'amountChanged', amountCents: 50000 }]);
    expect(s).toEqual({ kind: 'confirming', amountCents: 50000, uploaded: true, changedFrom: 61178 });
    const again = pixStep(s, { type: 'register' });
    expect(again).toMatchObject({ kind: 'sending', amountCents: 50000 });
    expect(mayUpload(again)).toBe(false);
  });

  it('falha no envio ou no registro: volta à prévia para tentar de novo', () => {
    const s = run([{ type: 'photo', amountCents: 100 }, { type: 'register' }, { type: 'failed' }]);
    expect(s).toEqual({ kind: 'confirming', amountCents: 100, uploaded: false });
  });

  it('registrado: fecha', () => {
    expect(run([{ type: 'photo', amountCents: 100 }, { type: 'register' }, { type: 'uploaded' }, { type: 'done' }])).toEqual(PIX_IDLE);
  });
});
