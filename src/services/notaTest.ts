/**
 * Teste experimental "abrir nota no app": o que o WebView nativo informou sobre
 * a página principal, em texto. Nunca é o veredito: "carregou" não quer dizer
 * "liberada" (a página de bloqueio da SEFAZ também carrega normalmente); o
 * resultado do teste é o que a pessoa viu na tela. Junto, o diagnóstico do
 * próprio WebView (sem ler a página): nomes dos cookies da SEFAZ antes de abrir
 * e depois de carregar (sem os valores), o cabeçalho X-Requested-With, a
 * versão do WebView e a identificação (User-Agent).
 */

export const LOADED_IS_NOT_ALLOWED =
  'Isso não quer dizer que a SEFAZ liberou: a página de bloqueio ("Request Rejected") também carrega normalmente. O resultado do teste é o que você viu na tela.';

const LOADED = 'A página terminou de carregar.';

const cookieList = (names: string) => (names ? names : 'nenhum');

export interface NotaTestReport {
  /** O que aconteceu com a página principal. */
  page: string[];
  /** Diagnóstico do WebView (configuração e sessão), sem o conteúdo da página. */
  diagnostics: string[];
}

export function notaTestReport(events: readonly string[]): NotaTestReport {
  const page: string[] = [];
  const diagnostics: string[] = [];
  let cookiesAfter: string | null = null;
  for (const e of events) {
    if (e === 'loaded') {
      if (!page.includes(LOADED)) page.push(LOADED);
    } else if (e.startsWith('http:')) {
      page.push(`A SEFAZ respondeu com o código HTTP ${e.slice(5)}.`);
    } else if (e.startsWith('error:')) {
      page.push(`Falha de rede: ${e.slice(6)}.`);
    } else if (e.startsWith('cookies-before:')) {
      diagnostics.push(`Cookies da SEFAZ guardados antes de abrir: ${cookieList(e.slice(15))}.`);
    } else if (e.startsWith('cookies-after:')) {
      // Vale o último carregamento (a página pode carregar mais de uma vez).
      cookiesAfter = e.slice(14);
    } else if (e === 'xrw:off') {
      diagnostics.push('Cabeçalho X-Requested-With: desligado, como no navegador.');
    } else if (e === 'xrw:unsupported') {
      diagnostics.push('Cabeçalho X-Requested-With: esta versão do WebView não permite desligar.');
    } else if (e.startsWith('webview:')) {
      diagnostics.push(`WebView: ${e.slice(8)}.`);
    } else if (e.startsWith('ua:')) {
      diagnostics.push(`Identificação (User-Agent): ${e.slice(3)}`);
    }
  }
  if (cookiesAfter !== null) diagnostics.push(`Cookies da SEFAZ depois de carregar: ${cookieList(cookiesAfter)}.`);
  if (page.length === 0) page.push('O WebView não informou nada sobre a página (fechado antes de carregar).');
  if (page.includes(LOADED)) page.push(LOADED_IS_NOT_ALLOWED);
  return { page, diagnostics };
}
