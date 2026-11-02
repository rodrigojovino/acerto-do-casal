import { describe, expect, it } from 'vitest';
import { LOADED_IS_NOT_ALLOWED, notaTestReport } from './notaTest';

describe('relatório do teste "abrir nota no app"', () => {
  it('carregou: avisa que carregar não quer dizer liberada', () => {
    expect(notaTestReport(['loaded'])).toEqual(['A página terminou de carregar.', LOADED_IS_NOT_ALLOWED]);
    expect(notaTestReport(['loaded', 'loaded'])).toHaveLength(2);
  });

  it('código HTTP e falha de rede da página principal', () => {
    expect(notaTestReport(['http:503', 'loaded'])).toEqual([
      'A SEFAZ respondeu com o código HTTP 503.',
      'A página terminou de carregar.',
      LOADED_IS_NOT_ALLOWED,
    ]);
    expect(notaTestReport(['error:net::ERR_CONNECTION_RESET'])).toEqual(['Falha de rede: net::ERR_CONNECTION_RESET.']);
  });

  it('nada informado: fechado antes de carregar', () => {
    expect(notaTestReport([])).toEqual(['O WebView não informou nada (fechado antes de carregar).']);
  });
});
