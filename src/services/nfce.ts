import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
// Mesmo parser das Functions: lê a chave de qualquer estado e monta a URL de consulta de SP.
import { NfceError, parseFiscalCode, parseTypedKey, type FiscalCode, type FiscalModel } from '../../functions/src/nfce';
import type { KeyEntry } from './expenseData';
import type { IsoDate } from '@/domain/calendar';
import type { Cents } from '@/domain/settlement';
import { functions } from './firebase';

/** Leitura de QR e código de barras só no app Android (ML Kit). */
export const canScanQr = Capacitor.isNativePlatform();

/** Erro de leitura com mensagem pronta para exibir. */
export class QrError extends Error {}

/** Documento fiscal identificado pela chave (lida ou digitada). */
export interface ScannedNfce {
  key: string;
  /** '55' = NF-e; '65' = NFC-e. */
  model: FiscalModel;
  entry: KeyEntry;
  /** Sigla da UF da nota, ex.: 'SP', 'MG'. */
  uf: string;
  /** CNPJ do emitente (14 dígitos), tirado da chave. */
  cnpj: string;
  /** Mês de emissão pela chave (`YYYY-MM`), disponível mesmo offline. */
  yearMonth: string;
  /** URL de consulta na SEFAZ-SP (só NFC-e de SP); null nas demais (sem conferência). */
  spUrl: string | null;
}

function toScanned(code: FiscalCode, entry: KeyEntry): ScannedNfce {
  return {
    key: code.key,
    model: code.access.model,
    entry,
    uf: code.access.uf ?? code.access.ufCode,
    cnpj: code.access.cnpj,
    yearMonth: code.access.yearMonth,
    spUrl: code.spUrl,
  };
}

/** "NF-e" ou "NFC-e", pelo modelo da chave. */
export const fiscalDocName = (model: string): string => (model === '55' ? 'NF-e' : 'NFC-e');

/** Chave digitada (aceita os espaços entre os blocos). Erro com mensagem pronta. */
export function typedFiscalKey(input: string): ScannedNfce {
  try {
    return toScanned(parseTypedKey(input), 'typed');
  } catch (err) {
    throw new QrError(err instanceof NfceError ? err.message : 'Chave inválida.');
  }
}

export interface NfcePrefill {
  issuerName: string;
  totalCents: Cents;
  date: IsoDate;
}

/**
 * Abre o leitor do Google e valida o QR Code da NFC-e ou o código de barras
 * (Code 128) da chave de NF-e/NFC-e, de qualquer estado. `null` se cancelar.
 */
export async function scanNfceQr(): Promise<ScannedNfce | null> {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
    throw new QrError('O leitor está sendo instalado pelo Google Play. Tente de novo em instantes.');
  }

  let raw: string | undefined;
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128], autoZoom: true });
    raw = barcodes[0]?.rawValue;
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('cancel')) return null;
    throw new QrError('Não foi possível abrir o leitor.');
  }
  if (!raw) return null;

  try {
    return toScanned(parseFiscalCode(raw), 'read');
  } catch (err) {
    throw new QrError(err instanceof NfceError ? err.message : 'Este código não é de uma nota fiscal.');
  }
}

/**
 * Nome do emitente pelo CNPJ (Function `lookupCnpj`, com cache): nome fantasia
 * ou razão social. Offline ou com falha, `null` (fica o CNPJ formatado).
 */
export async function lookupCnpjName(cnpj: string): Promise<string | null> {
  if (!navigator.onLine) return null;
  try {
    const call = httpsCallable<{ cnpj: string }, { name: string | null }>(functions, 'lookupCnpj', { timeout: 15_000 });
    return (await call({ cnpj })).data.name;
  } catch {
    return null;
  }
}

/** "12345678000190" → "12.345.678/0001-90". */
export function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Só SP, online: consulta a SEFAZ (pela Function) para pré-preencher o formulário.
 * Offline ou com falha, devolve o motivo e o QR segue como comprovante (plano B).
 */
export async function lookupNfce(spUrl: string): Promise<{ data: NfcePrefill } | { error: string }> {
  if (!navigator.onLine) return { error: 'Sem conexão: digite o valor. A nota será conferida quando a conexão voltar.' };
  try {
    const call = httpsCallable<{ url: string }, NfcePrefill & { key: string; issuerCnpj: string }>(
      functions,
      'resolveNfce',
      { timeout: 20_000 },
    );
    const { data } = await call({ url: spUrl });
    return { data: { issuerName: data.issuerName, totalCents: data.totalCents, date: data.date } };
  } catch (err) {
    const message =
      err instanceof FirebaseError && err.code !== 'functions/internal' && err.code !== 'functions/deadline-exceeded'
        ? err.message
        : 'A SEFAZ não respondeu.';
    return { error: `${message} Digite o valor; a nota continua valendo como comprovante.` };
  }
}
