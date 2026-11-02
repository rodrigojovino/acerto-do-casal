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
  openExternal(options: { url: string }): Promise<void>;
}

const NotaWebView = registerPlugin<NotaWebViewPlugin>('NotaWebView');

/** O teste só existe no app Android (o WebView nativo). */
export const notaWebViewAvailable = (): boolean => Capacitor.getPlatform() === 'android';

export async function openNotaInApp(url: string): Promise<string[]> {
  return (await NotaWebView.open({ url })).events;
}

export async function openNotaInBrowser(url: string): Promise<void> {
  await NotaWebView.openExternal({ url });
}
