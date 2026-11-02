import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CNPJ_WAIT_MS, NFCE_WAIT_MS, createSaveLock, saveButton, withTimeout } from './saveButton';

describe('estado do botão Salvar', () => {
  it('livre: habilitado, com o texto normal', () => {
    expect(saveButton([], false, 'Salvar gasto')).toEqual({ disabled: false, label: 'Salvar gasto', busy: false });
  });

  it('cada espera desabilita e mostra o motivo', () => {
    expect(saveButton(['photo'], false, 'Salvar gasto')).toMatchObject({ disabled: true, label: 'Processando foto…' });
    expect(saveButton(['nfce'], false, 'Salvar gasto')).toMatchObject({ disabled: true, label: 'Consultando a nota…' });
    expect(saveButton(['cnpj'], false, 'Salvar alteração')).toMatchObject({ disabled: true, label: 'Buscando o emitente…' });
  });

  it('várias esperas: mostra a foto primeiro, depois a nota', () => {
    expect(saveButton(['cnpj', 'nfce', 'photo'], false, 'Salvar gasto').label).toBe('Processando foto…');
    expect(saveButton(['cnpj', 'nfce'], false, 'Salvar gasto').label).toBe('Consultando a nota…');
  });

  it('salvando (toque duplo): desabilitado acima de tudo', () => {
    expect(saveButton(['photo'], true, 'Salvar gasto')).toEqual({ disabled: true, label: 'Salvando…', busy: true });
  });
});

describe('limite de tempo das consultas', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resposta dentro do limite: usa a resposta', async () => {
    const answer = new Promise<string>((r) => setTimeout(() => r('Mercado X'), 3000));
    const result = withTimeout(answer, NFCE_WAIT_MS, 'plano B');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('Mercado X');
  });

  it('esgotado (SEFAZ 10 s, CNPJ 5 s): libera no plano B e ignora a resposta tardia', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('tarde'), 30_000));
    const nfce = withTimeout(slow, NFCE_WAIT_MS, 'plano B');
    const cnpj = withTimeout(slow, CNPJ_WAIT_MS, null);
    await vi.advanceTimersByTimeAsync(CNPJ_WAIT_MS);
    expect(await cnpj).toBeNull();
    await vi.advanceTimersByTimeAsync(NFCE_WAIT_MS - CNPJ_WAIT_MS);
    expect(await nfce).toBe('plano B');
  });

  it('falha: libera no plano B na hora', async () => {
    expect(await withTimeout(Promise.reject(new Error('rede')), NFCE_WAIT_MS, 'plano B')).toBe('plano B');
  });

  it('offline: a consulta já devolve na hora (sem rede), sem esperar o limite', async () => {
    const offline = Promise.resolve({ error: 'Sem conexão' });
    expect(await withTimeout(offline, NFCE_WAIT_MS, { error: 'esgotado' })).toEqual({ error: 'Sem conexão' });
  });
});

describe('toque duplo', () => {
  it('o primeiro toque grava; os seguintes não', () => {
    const lock = createSaveLock();
    expect(lock.tryLock()).toBe(true);
    expect(lock.tryLock()).toBe(false);
    expect(lock.tryLock()).toBe(false);
    expect(lock.locked).toBe(true);
  });

  it('desistindo no meio (fechou a categoria), libera para tentar de novo', () => {
    const lock = createSaveLock();
    lock.tryLock();
    lock.release();
    expect(lock.tryLock()).toBe(true);
  });
});
