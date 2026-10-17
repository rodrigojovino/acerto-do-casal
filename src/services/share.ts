import { Share } from '@capacitor/share';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Compartilha um texto pela folha nativa (Android, ou navegador com Web Share).
 * Sem suporte a compartilhamento, copia para a área de transferência.
 */
export async function shareText(text: string): Promise<ShareOutcome> {
  const { value: canShare } = await Share.canShare();
  if (canShare) {
    try {
      await Share.share({ text, dialogTitle: 'Enviar código de convite' });
      return 'shared';
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';
      if (message.includes('cancel') || message.includes('abort')) return 'cancelled';
      // Segue para copiar.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
