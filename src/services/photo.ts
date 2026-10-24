import { Camera } from '@capacitor/camera';
import { MAX_RECEIPT_BYTES, compressToLimit, type CompressedImage, type JpegEncoder } from '@/domain/image';

/** Erro de foto com mensagem pronta para exibir. */
export class PhotoError extends Error {}

export type PhotoSource = 'camera' | 'gallery';

/**
 * Tira ou escolhe a foto do comprovante e comprime no aparelho (JPEG < 500 KB;
 * a foto do cartão de saldo usa um limite menor). Retorna `null` se a pessoa cancelar.
 */
export async function pickReceiptPhoto(source: PhotoSource, maxBytes = MAX_RECEIPT_BYTES): Promise<CompressedImage | null> {
  const original = await pickOriginalPhoto(source);
  if (!original) return null;
  try {
    return await compressImage(original, maxBytes);
  } catch {
    throw new PhotoError('Não foi possível preparar a foto. Tente outra.');
  }
}

/**
 * Tira ou escolhe a foto, sem comprimir (a foto do cartão comprime e, se
 * preciso, recomprime a partir do original). Retorna `null` se a pessoa cancelar.
 */
export async function pickOriginalPhoto(source: PhotoSource): Promise<Blob | null> {
  let webPath: string | undefined;
  try {
    if (source === 'camera') {
      const result = await Camera.takePhoto({ quality: 90, correctOrientation: true, webUseInput: true });
      webPath = result.webPath;
    } else {
      const { results } = await Camera.chooseFromGallery({ limit: 1, quality: 90, correctOrientation: true, webUseInput: true });
      webPath = results[0]?.webPath;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('cancel')) return null;
    throw new PhotoError('Não foi possível abrir a câmera ou a galeria.');
  }
  if (!webPath) return null;

  try {
    return await (await fetch(webPath)).blob();
  } catch {
    throw new PhotoError('Não foi possível preparar a foto. Tente outra.');
  }
}

/** Comprime uma imagem com canvas, respeitando a orientação EXIF. */
export async function compressImage(original: Blob, maxBytes = MAX_RECEIPT_BYTES): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    const encode: JpegEncoder = async (size, quality) => {
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas indisponível');
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const data = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('falha ao gerar JPEG'))), 'image/jpeg', quality),
      );
      return { bytes: data.size, data };
    };
    return await compressToLimit({ width: bitmap.width, height: bitmap.height }, encode, maxBytes);
  } finally {
    bitmap.close();
  }
}
