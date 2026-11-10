import type { NfceItems } from '../../functions/src/nfce.js';
import type { Cents } from './settlement.js';

/**
 * Marcação dos itens da NFC-e (v0.9.2): cada item é dividido (padrão), só de
 * quem vê ou só do parceiro. Na tela, relativa a QUEM VÊ; no gasto, relativa a
 * QUEM PAGOU, numa letra por item ('s' dividido, 'p' só de quem pagou, 'o' só
 * do outro membro), com a assinatura dos itens. Informativa: a conta usa só os
 * totais ("Só minha" e "Só de [nome]"), que a marcação preenche.
 */

export type ViewerMark = 'shared' | 'mine' | 'partner';

/** Tela → gasto (relativo a quem pagou). */
export function storeMarks(marks: readonly ViewerMark[], viewerUid: string, payerUid: string): string {
  const viewerPaid = viewerUid === payerUid;
  return marks
    .map((m) => (m === 'shared' ? 's' : (m === 'mine') === viewerPaid ? 'p' : 'o'))
    .join('');
}

/** Gasto → tela (a inversa de storeMarks). */
export function readMarks(stored: string, viewerUid: string, payerUid: string): ViewerMark[] {
  const viewerPaid = viewerUid === payerUid;
  return [...stored].map((c) => (c === 's' ? 'shared' : (c === 'p') === viewerPaid ? 'mine' : 'partner'));
}

/**
 * Soma das partes marcadas, com o desconto da nota distribuído na mesma
 * proporção (os itens somam o valor antes do desconto; a nota paga é menor).
 * Arredonda cada parte para baixo: as duas juntas nunca passam do valor pago.
 */
export function sumsFromMarks(items: Pick<NfceItems, 'items' | 'itemsSumCents' | 'discountCents'>, marks: readonly ViewerMark[]): {
  mineCents: Cents;
  partnerCents: Cents;
} {
  let mine = 0;
  let partner = 0;
  items.items.forEach((item, i) => {
    if (marks[i] === 'mine') mine += item.totalCents;
    else if (marks[i] === 'partner') partner += item.totalCents;
  });
  const gross = items.itemsSumCents;
  const paid = gross - items.discountCents;
  if (gross <= 0 || paid === gross) return { mineCents: mine, partnerCents: partner };
  const net = (c: number) => Math.floor((c * paid) / gross);
  return { mineCents: net(mine), partnerCents: net(partner) };
}

/** Assinatura curta (8 hex, FNV-1a) das descrições e valores dos itens, na ordem da nota. */
export function itemsSignature(items: Pick<NfceItems, 'items'>): string {
  let h = 0x811c9dc5;
  const text = items.items.map((i) => `${i.description}|${i.totalCents}`).join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** As marcações guardadas ainda correspondem a estes itens (mesma quantidade, descrições e valores)? */
export function marksMatch(stored: { m: string; sig: string }, items: Pick<NfceItems, 'items'>): boolean {
  return stored.m.length === items.items.length && stored.sig === itemsSignature(items);
}

/** Há alguma marcação diferente de "dividido"? */
export function hasMarks(marks: readonly ViewerMark[] | null | undefined): boolean {
  return !!marks && marks.some((m) => m !== 'shared');
}

/**
 * Iniciais do casal para as marcações e as etiquetas: a primeira letra do
 * primeiro nome; se as duas forem iguais, as duas primeiras letras.
 * A inicial identifica a pessoa e não muda com quem vê.
 */
export function coupleInitials(nameA: string, nameB: string): [string, string] {
  const clean = (n: string) => n.trim().normalize('NFC');
  const a = clean(nameA);
  const b = clean(nameB);
  const first = (n: string, size: number) => (n.slice(0, size) || '?').toLocaleUpperCase('pt-BR').slice(0, 1) + n.slice(1, size).toLocaleLowerCase('pt-BR');
  const same = a.slice(0, 1).toLocaleUpperCase('pt-BR') === b.slice(0, 1).toLocaleUpperCase('pt-BR');
  return same ? [first(a, 2), first(b, 2)] : [first(a, 1), first(b, 1)];
}
