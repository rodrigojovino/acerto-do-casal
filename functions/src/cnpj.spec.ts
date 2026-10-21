import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRASIL_API_CNPJ, fetchCnpjName, isValidCnpj, parseCnpjResponse } from './cnpj';

// CNPJs e respostas fictícios (formato da BrasilAPI), nenhuma empresa real.

describe('isValidCnpj', () => {
  it('confere os dois dígitos verificadores', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11444777000161')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('1122233300018A')).toBe(false);
  });
});

describe('parseCnpjResponse', () => {
  it('nome fantasia primeiro; sem ele, a razão social', () => {
    expect(parseCnpjResponse({ nome_fantasia: '  Mercado  Teste ', razao_social: 'MERCADO TESTE LTDA' })).toEqual({
      name: 'Mercado Teste',
      fantasyName: 'Mercado Teste',
      legalName: 'MERCADO TESTE LTDA',
    });
    expect(parseCnpjResponse({ nome_fantasia: '', razao_social: 'FARMACIA EXEMPLO LTDA' })?.name).toBe('FARMACIA EXEMPLO LTDA');
    expect(parseCnpjResponse({ nome_fantasia: null, razao_social: 'X'.repeat(120) })?.name).toHaveLength(80);
  });

  it('sem nenhum nome (ou resposta estranha): null', () => {
    expect(parseCnpjResponse({ nome_fantasia: ' ', razao_social: '' })).toBeNull();
    expect(parseCnpjResponse(null)).toBeNull();
    expect(parseCnpjResponse('erro')).toBeNull();
  });
});

describe('fetchCnpjName', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('manda User-Agent próprio (o Cloudflare da BrasilAPI recusa o padrão do Node)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ nome_fantasia: 'Mercado Teste' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchCnpjName('11222333000181'))?.name).toBe('Mercado Teste');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BRASIL_API_CNPJ}11222333000181`);
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^acerto-do-casal\//);
    expect(init.redirect).toBe('error');
  });

  it('recusa (403) vai para o log; não encontrado (404) não; os dois devolvem null', async () => {
    const reasons: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })));
    expect(await fetchCnpjName('11222333000181', 8000, (r) => reasons.push(r))).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await fetchCnpjName('11222333000181', 8000, (r) => reasons.push(r))).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('rede fora'))));
    expect(await fetchCnpjName('11222333000181', 8000, (r) => reasons.push(r))).toBeNull();
    expect(reasons).toEqual(['HTTP 403', 'rede fora']);
  });
});
