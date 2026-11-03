import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Página oficial da NFC-e de SP (Android): plugin local `NotaWebView`
 * (android/.../NotaWebViewPlugin.java). `read` abre a página num WebView do
 * app, visível, uma vez, e devolve o HTML quando ela termina de carregar (a
 * reserva quando o servidor não consegue consultar); `openExternal` abre a
 * mesma URL no navegador do celular ("Ver a nota na SEFAZ").
 */
interface NotaWebViewPlugin {
  read(options: { url: string; timeoutMs: number }): Promise<{ html?: string | null; events: string[] }>;
  openExternal(options: { url: string }): Promise<void>;
}

const NotaWebView = registerPlugin<NotaWebViewPlugin>('NotaWebView');

/** O WebView nativo só existe no app Android. */
export const notaWebViewAvailable = (): boolean => Capacitor.getPlatform() === 'android';

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
