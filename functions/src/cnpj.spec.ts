import { describe, expect, it } from 'vitest';
import { isValidCnpj, parseCnpjResponse } from './cnpj';

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
