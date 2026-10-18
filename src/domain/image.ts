/**
 * Compressão do comprovante no aparelho: JPEG abaixo de 500 KB.
 * Lógica pura; quem codifica de fato (canvas) é injetado, para testar sem navegador.
 */

export const MAX_RECEIPT_BYTES = 500 * 1024;
/** Lado maior inicial: legível para um cupom fiscal sem desperdiçar bytes. */
export const MAX_RECEIPT_SIDE = 1600;
/** Abaixo disso o texto do cupom fica ilegível; melhor reduzir a resolução. */
const MIN_QUALITY = 0.5;
const QUALITIES = [0.82, 0.72, 0.62, MIN_QUALITY];
const MIN_SIDE = 640;

export interface Size {
  width: number;
  height: number;
}

/** Reduz para caber em `maxSide` no lado maior, mantendo a proporção. Nunca amplia. */
export function fitWithin({ width, height }: Size, maxSide: number): Size {
  if (width <= 0 || height <= 0) throw new RangeError('imagem sem dimensões');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type JpegEncoder = (size: Size, quality: number) => Promise<{ bytes: number; data: Blob }>;

export interface CompressedImage {
  data: Blob;
  bytes: number;
  size: Size;
  quality: number;
}

/**
 * Tenta qualidades decrescentes; se nem a mínima couber, reduz a resolução
 * em 20% e tenta de novo. Falha só se nem 640px na qualidade mínima couber.
 */
export async function compressToLimit(
  original: Size,
  encode: JpegEncoder,
  maxBytes = MAX_RECEIPT_BYTES,
): Promise<CompressedImage> {
  let size = fitWithin(original, MAX_RECEIPT_SIDE);
  for (;;) {
    for (const quality of QUALITIES) {
      const { bytes, data } = await encode(size, quality);
      if (bytes <= maxBytes) return { data, bytes, size, quality };
    }
    const longest = Math.max(size.width, size.height);
    if (longest <= MIN_SIDE) throw new RangeError('não foi possível reduzir a foto abaixo do limite');
    size = fitWithin(size, Math.max(MIN_SIDE, Math.round(longest * 0.8)));
  }
}

/** Caminho da foto no Storage (único por gasto). */
/** O comprovante tem foto (de recibo, ou da nota junto com a chave)? */
export function receiptHasPhoto<R extends { type: string; photoPath?: string }>(
  receipt: R,
): receipt is R & { photoPath: string; photoUploaded?: boolean } {
  return receipt.type === 'photo' || (receipt.type === 'nfce' && !!receipt.photoPath);
}

export function receiptPhotoPath(groupId: string, expenseId: string): string {
  return `groups/${groupId}/receipts/${expenseId}.jpg`;
}
