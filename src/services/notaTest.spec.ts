import { describe, expect, it } from 'vitest';
import { LOADED_IS_NOT_ALLOWED, notaTestReport } from './notaTest';

describe('relatório do teste "abrir nota no app"', () => {
  it('carregou: avisa que carregar não quer dizer liberada', () => {
    expect(notaTestReport(['loaded']).page).toEqual(['A página terminou de carregar.', LOADED_IS_NOT_ALLOWED]);
    expect(notaTestReport(['loaded', 'loaded']).page).toHaveLength(2);
  });

  it('código HTTP e falha de rede da página principal', () => {
    expect(notaTestReport(['http:503', 'loaded']).page).toEqual([
      'A SEFAZ respondeu com o código HTTP 503.',
      'A página terminou de carregar.',
      LOADED_IS_NOT_ALLOWED,
    ]);
    expect(notaTestReport(['error:net::ERR_CONNECTION_RESET']).page).toEqual(['Falha de rede: net::ERR_CONNECTION_RESET.']);
  });

  it('nada informado: fechado antes de carregar', () => {
    expect(notaTestReport([]).page).toEqual(['O WebView não informou nada sobre a página (fechado antes de carregar).']);
  });

  it('diagnóstico: cookies antes e depois (só nomes), cabeçalho, versão e identificação', () => {
    const r = notaTestReport([
      'xrw:off',
      'webview:com.google.android.webview 130.0.6723.102',
      'ua:Mozilla/5.0 (Linux; Android 14; wv)',
      'cookies-before:',
      'loaded',
      'cookies-after:TS01abc',
      'loaded',
      'cookies-after:TS01abc, f5avr',
    ]);
    expect(r.diagnostics).toEqual([
      'Cabeçalho X-Requested-With: desligado, como no navegador.',
      'WebView: com.google.android.webview 130.0.6723.102.',
      'Identificação (User-Agent): Mozilla/5.0 (Linux; Android 14; wv)',
      'Cookies da SEFAZ guardados antes de abrir: nenhum.',
      'Cookies da SEFAZ depois de carregar: TS01abc, f5avr.',
    ]);
    expect(notaTestReport(['xrw:unsupported']).diagnostics).toEqual([
      'Cabeçalho X-Requested-With: esta versão do WebView não permite desligar.',
    ]);
  });
});
