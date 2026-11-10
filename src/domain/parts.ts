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

/** Parte só de uma pessoa, do ponto de vista de quem vê (etiquetas e chips). */
export interface PartTag {
  /** 'viewer': de quem vê (preenchida); 'partner': do parceiro (vazada). */
  owner: 'viewer' | 'partner';
  /** Quem é o dono (a inicial identifica a pessoa e não muda com quem vê). */
  ownerUid: string;
  cents: Cents;
}

/**
 * Banco (relativo a quem pagou) → etiquetas (relativas a quem vê): a parte
 * pessoal é de quem pagou; a do parceiro, do outro membro. Só as maiores que
 * zero, a de quem vê primeiro.
 */
export function partTagsForViewer(
  e: { personalCents: Cents; partnerOnlyCents?: Cents; payerUid: string },
  viewerUid: string,
  partnerUid: string,
): PartTag[] {
  const nonPayer = e.payerUid === viewerUid ? partnerUid : viewerUid;
  const tags: PartTag[] = [];
  if (e.personalCents > 0) tags.push({ owner: e.payerUid === viewerUid ? 'viewer' : 'partner', ownerUid: e.payerUid, cents: e.personalCents });
  const partner = e.partnerOnlyCents ?? 0;
  if (partner > 0) tags.push({ owner: nonPayer === viewerUid ? 'viewer' : 'partner', ownerUid: nonPayer, cents: partner });
  return tags.sort((a, b) => (a.owner === b.owner ? 0 : a.owner === 'viewer' ? -1 : 1));
}
