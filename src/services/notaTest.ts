/**
 * Teste experimental "abrir nota no app": o que o WebView nativo informou sobre
 * a página principal, em texto. Nunca é o veredito: "carregou" não quer dizer
 * "liberada" (a página de bloqueio da SEFAZ também carrega normalmente); o
 * resultado do teste é o que a pessoa viu na tela.
 */

export const LOADED_IS_NOT_ALLOWED =
  'Isso não quer dizer que a SEFAZ liberou: a página de bloqueio ("Request Rejected") também carrega normalmente. O resultado do teste é o que você viu na tela.';

export function notaTestReport(events: readonly string[]): string[] {
  const lines: string[] = [];
  for (const e of events) {
    if (e === 'loaded') {
      if (!lines.includes('A página terminou de carregar.')) lines.push('A página terminou de carregar.');
    } else if (e.startsWith('http:')) {
      lines.push(`A SEFAZ respondeu com o código HTTP ${e.slice(5)}.`);
    } else if (e.startsWith('error:')) {
      lines.push(`Falha de rede: ${e.slice(6)}.`);
    }
  }
  if (lines.length === 0) return ['O WebView não informou nada (fechado antes de carregar).'];
  if (lines.includes('A página terminou de carregar.')) lines.push(LOADED_IS_NOT_ALLOWED);
  return lines;
}
