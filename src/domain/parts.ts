import type { Cents } from './settlement.js';

/**
 * Parte só de uma pessoa num gasto (v0.9.2), em dois referenciais:
 * - no banco, relativas a QUEM PAGOU: personalCents (só de quem pagou) e
 *   partnerOnlyCents (só do outro membro);
 * - na tela, relativas a QUEM VÊ (ou lança): "Só minha" e "Só de [nome]",
 *   rótulos fixos que não mudam com quem pagou.
 * Converter só por estas funções (a mesma lição do bug da divisão "eu / outro").
 */

/** As partes do ponto de vista de quem vê: a minha e a do parceiro. */
export interface ViewerParts {
  mineCents: Cents;
  partnerCents: Cents;
}

/** As partes como o banco guarda: de quem pagou e do outro membro. */
export interface PayerParts {
  personalCents: Cents;
  partnerOnlyCents: Cents;
}

/**
 * Tela → banco. Se quem vê pagou: pessoal = "Só minha", parceiro = "Só de [nome]".
 * Se o parceiro pagou: pessoal (dele) = "Só de [nome]", parceiro (o outro, eu) = "Só minha".
 */
export function payerPartsFromViewer(parts: ViewerParts, viewerUid: string, payerUid: string): PayerParts {
  return viewerUid === payerUid
    ? { personalCents: parts.mineCents, partnerOnlyCents: parts.partnerCents }
    : { personalCents: parts.partnerCents, partnerOnlyCents: parts.mineCents };
}

/** Banco → tela (a inversa de payerPartsFromViewer). Parte do parceiro ausente = 0. */
export function viewerPartsFromPayer(
  parts: { personalCents: Cents; partnerOnlyCents?: Cents },
  viewerUid: string,
  payerUid: string,
): ViewerParts {
  const partnerOnly = parts.partnerOnlyCents ?? 0;
  return viewerUid === payerUid
    ? { mineCents: parts.personalCents, partnerCents: partnerOnly }
    : { mineCents: partnerOnly, partnerCents: parts.personalCents };
}

/** As duas partes juntas cabem no total (a validação do formulário e das regras). */
export function partsFitTotal(parts: PayerParts | ViewerParts, totalCents: Cents): boolean {
  const sum = 'personalCents' in parts ? parts.personalCents + parts.partnerOnlyCents : parts.mineCents + parts.partnerCents;
  return sum <= totalCents;
}
