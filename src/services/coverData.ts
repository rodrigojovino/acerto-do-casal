import { clampFraming, type CoverFraming } from '@/domain/cover';

/**
 * Documento da foto do cartão (`groups/{g}/cover/current`), exatamente como é
 * gravado. A foto vai em base64 (JPEG comprimido no aparelho), num documento
 * próprio para não pesar o do grupo: assim ela vem com o cache offline e os
 * pixels podem ser lidos para a conta de legibilidade, sem o Storage. Sem
 * dependência do SDK (horário do servidor por parâmetro), para os testes de
 * regras usarem as mesmas funções.
 */

export const COVER_DOC_ID = 'current';

export interface CoverImage {
  /** JPEG em base64, sem o prefixo `data:`. */
  image: string;
  width: number;
  height: number;
}

/** Foto nova (ou trocada), com o enquadramento escolhido. */
export function coverData<T>(photo: CoverImage, framing: CoverFraming, uid: string, now: T) {
  return { ...photo, ...clampFraming(framing), updatedBy: uid, updatedAt: now };
}

/** Só o enquadramento, o escurecimento e o desfoque mudam (a foto fica). */
export function coverFramingData<T>(framing: CoverFraming, uid: string, now: T) {
  return { ...clampFraming(framing), updatedBy: uid, updatedAt: now };
}
