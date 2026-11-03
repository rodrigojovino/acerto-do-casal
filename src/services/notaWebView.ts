import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Teste experimental "abrir nota no app" (Android): plugin local
 * `NotaWebView` (android/.../NotaWebViewPlugin.java). `open` abre a página
 * oficial da nota num WebView do app e resolve ao fechar, com o que o WebView
 * informou sobre a página principal (sem o conteúdo); `openExternal` abre a
 * mesma URL no navegador do celular.
 */
interface NotaWebViewPlugin {
  open(options: { url: string }): Promise<{ events: string[] }>;
  read(options: { url: string; timeoutMs: number }): Promise<{ html?: string | null; events: string[] }>;
  openExternal(options: { url: string }): Promise<void>;
}

const NotaWebView = registerPlugin<NotaWebViewPlugin>('NotaWebView');

/** O teste só existe no app Android (o WebView nativo). */
export const notaWebViewAvailable = (): boolean => Capacitor.getPlatform() === 'android';

export async function openNotaInApp(url: string): Promise<string[]> {
  return (await NotaWebView.open({ url })).events;
}

/**
 * Leitura da nota no WebView do app (Android), visível, uma vez: o HTML da
 * página quando ela termina de carregar, ou null (bloqueio, falha, tempo).
 */
export async function readNotaInApp(url: string, timeoutMs: number): Promise<{ html: string | null; events: string[] }> {
  const r = await NotaWebView.read({ url, timeoutMs: Math.max(1, Math.round(timeoutMs)) });
  return { html: r.html ?? null, events: r.events };
}

/** "Ver a nota na SEFAZ": o navegador do celular (Android) ou uma aba nova (web). */
export async function openNotaInBrowser(url: string): Promise<void> {
  if (!notaWebViewAvailable()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await NotaWebView.openExternal({ url });
}
