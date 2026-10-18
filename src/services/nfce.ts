import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
// Mesmo parser das Functions: valida a URL (só SEFAZ-SP) e a chave no aparelho.
import { NfceError, parseAccessKey, parseQrUrl } from '../../functions/src/nfce';
import type { IsoDate } from '@/domain/calendar';
import type { Cents } from '@/domain/settlement';
import { functions } from './firebase';

/** Leitura de QR só no app Android (ML Kit). */
export const canScanQr = Capacitor.isNativePlatform();

/** Erro de leitura com mensagem pronta para exibir. */
export class QrError extends Error {}

export interface ScannedNfce {
  url: string;
  key: string;
  /** Mês de emissão pela chave (`YYYY-MM`), disponível mesmo offline. */
  yearMonth: string;
}

export interface NfcePrefill {
  issuerName: string;
  totalCents: Cents;
  date: IsoDate;
}

/** Abre o leitor do Google e valida o QR. `null` se a pessoa cancelar. */
export async function scanNfceQr(): Promise<ScannedNfce | null> {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
    throw new QrError('O leitor de QR Code está sendo instalado pelo Google Play. Tente de novo em instantes.');
  }

  let raw: string | undefined;
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode], autoZoom: true });
    raw = barcodes[0]?.rawValue;
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('cancel')) return null;
    throw new QrError('Não foi possível abrir o leitor de QR Code.');
  }
  if (!raw) return null;

  try {
    const qr = parseQrUrl(raw);
    return { url: raw.trim(), key: qr.key, yearMonth: parseAccessKey(qr.key).yearMonth };
  } catch (err) {
    throw new QrError(err instanceof NfceError ? err.message : 'Este QR Code não é de uma nota fiscal.');
  }
}

/**
 * Online: consulta a SEFAZ (pela Function) para pré-preencher o formulário.
 * Offline ou com falha, devolve o motivo e o QR segue como comprovante (plano B).
 */
export async function lookupNfce(url: string): Promise<{ data: NfcePrefill } | { error: string }> {
  if (!navigator.onLine) return { error: 'Sem conexão: digite o valor. A nota será conferida quando a conexão voltar.' };
  try {
    const call = httpsCallable<{ url: string }, NfcePrefill & { key: string; issuerCnpj: string }>(
      functions,
      'resolveNfce',
      { timeout: 20_000 },
    );
    const { data } = await call({ url });
    return { data: { issuerName: data.issuerName, totalCents: data.totalCents, date: data.date } };
  } catch (err) {
    const message =
      err instanceof FirebaseError && err.code !== 'functions/internal' && err.code !== 'functions/deadline-exceeded'
        ? err.message
        : 'A SEFAZ não respondeu.';
    return { error: `${message} Digite o valor; o QR continua valendo como comprovante.` };
  }
}
