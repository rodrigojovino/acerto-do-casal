import { describe, expect, it } from 'vitest';
import { DEVICE_MIN_MS, NFCE_BUDGET_MS, mergeOutcome, remainingMs, shouldTryDevice, spReceiptStatus } from './nfceFlow';

describe('leituras seguidas da mesma nota (o QR lido de novo)', () => {
  it('servidor ok antes e barrado depois: continua ok, e a nota vai para o gatilho com o resultado guardado', () => {
    const merged = mergeOutcome({ server: 'ok', device: 'skipped' }, { server: 'failed', device: 'failed' });
    expect(merged).toEqual({ server: 'ok', device: 'failed' });
    expect(spReceiptStatus(merged)).toBe('pending');
  });

  it('aparelho ok antes e falha depois: continua lida no aparelho', () => {
    expect(mergeOutcome({ server: 'failed', device: 'ok' }, { server: 'failed', device: 'failed' })).toEqual({ server: 'failed', device: 'ok' });
  });

  it('primeira leitura: o resultado dela', () => {
    expect(mergeOutcome(undefined, { server: 'failed', device: 'skipped' })).toEqual({ server: 'failed', device: 'skipped' });
  });

  it('offline depois de uma tentativa: a tentativa anterior vale', () => {
    expect(mergeOutcome({ server: 'failed', device: 'failed' }, { server: 'skipped', device: 'skipped' })).toEqual({ server: 'failed', device: 'failed' });
  });
});

describe('estado gravado na NFC-e de SP (no máximo duas consultas por nota)', () => {
  it('servidor deu certo: pending (o gatilho usa o resultado guardado, sem rede)', () => {
    expect(spReceiptStatus({ server: 'ok', device: 'skipped' })).toBe('pending');
  });

  it('servidor falhou e o aparelho tentou: unchecked, com ou sem sucesso no aparelho', () => {
    expect(spReceiptStatus({ server: 'failed', device: 'ok' })).toBe('unchecked');
    expect(spReceiptStatus({ server: 'failed', device: 'failed' })).toBe('unchecked');
  });

  it('servidor falhou sem WebView (versão web): pending, o gatilho faz a segunda', () => {
    expect(spReceiptStatus({ server: 'failed', device: 'skipped' })).toBe('pending');
  });

  it('offline, sem tentativa: pending, o gatilho faz uma', () => {
    expect(spReceiptStatus({ server: 'skipped', device: 'skipped' })).toBe('pending');
  });
});

describe('limite de 10 s para as duas tentativas', () => {
  it('o aparelho usa o que sobrar do servidor', () => {
    const deadline = 1_000 + NFCE_BUDGET_MS;
    expect(remainingMs(deadline, 1_030)).toBe(9_970);
    expect(remainingMs(deadline, deadline + 5)).toBe(0);
  });

  it('tenta no aparelho só se o servidor falhou, há WebView e sobra tempo', () => {
    expect(shouldTryDevice('failed', true, 9_970)).toBe(true);
    expect(shouldTryDevice('failed', true, DEVICE_MIN_MS - 1)).toBe(false);
    expect(shouldTryDevice('failed', false, 9_970)).toBe(false);
    expect(shouldTryDevice('ok', true, 9_970)).toBe(false);
    expect(shouldTryDevice('skipped', true, 9_970)).toBe(false);
  });
});
