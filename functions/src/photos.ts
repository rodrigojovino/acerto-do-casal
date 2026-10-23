/**
 * Fotos órfãs no Storage: arquivos de comprovante que nenhum documento usa
 * mais (gasto que trocou de foto para outro comprovante, foto da nota removida
 * da chave, gasto excluído offline, comprovante PIX de um pagamento que não
 * chegou a ser registrado). Funções puras, usadas pela varredura semanal
 * (`cleanOrphanPhotos`) e pelo script `scripts/admin/fotos-orfas.ts`.
 */

/** Prazo antes de apagar: protege uma edição em andamento que vai usar o mesmo caminho. */
export const ORPHAN_GRACE_DAYS = 7;

/** Só estas pastas têm comprovantes: fotos de recibo/nota e comprovantes PIX. */
const PHOTO_PATH = /^groups\/[^/]+\/(receipts\/[^/]+\.jpg|settlements\/[^/]+\/[^/]+\.jpg)$/;

export type PhotoKind = 'receipt' | 'settlement';

export function photoKind(path: string): PhotoKind | null {
  if (!PHOTO_PATH.test(path)) return null;
  return path.split('/')[2] === 'receipts' ? 'receipt' : 'settlement';
}

export interface StoredFile {
  path: string;
  /** Última gravação do arquivo (metadado `updated` do Storage). */
  updated: Date;
  size: number;
}

/** Caminho da foto que um gasto usa (foto de recibo, ou da nota junto com a chave). */
export function expensePhotoPath(expense: { receipt?: { photoPath?: unknown } }): string | null {
  const path = expense.receipt?.photoPath;
  return typeof path === 'string' ? path : null;
}

/** Caminhos dos comprovantes PIX dos pagamentos registrados num mês. */
export function monthPhotoPaths(month: { payments?: unknown }): string[] {
  if (!Array.isArray(month.payments)) return [];
  return month.payments
    .map((p) => (p as { receiptPath?: unknown } | null)?.receiptPath)
    .filter((p): p is string => typeof p === 'string');
}

export interface OrphanReport {
  /** Arquivos de comprovante encontrados (outros caminhos são ignorados). */
  files: number;
  referenced: number;
  /** Órfãos que podem sair agora (mais antigos que o prazo). */
  orphans: StoredFile[];
  /** Órfãos ainda dentro do prazo: ficam até a próxima varredura. */
  recent: number;
  byKind: Record<PhotoKind, number>;
  orphanBytes: number;
}

/**
 * Separa os arquivos de comprovante que podem ser apagados: nenhum gasto nem
 * pagamento usa o caminho e a última gravação tem mais de `graceDays` dias.
 * Uma série usa a foto da parcela 1 enquanto qualquer parcela a referenciar
 * (inclusive de mês fechado), então ela fica. Comprovante PIX de pagamento
 * registrado nunca sai.
 */
export function orphanPhotos(
  files: readonly StoredFile[],
  referenced: ReadonlySet<string>,
  now: Date,
  graceDays = ORPHAN_GRACE_DAYS,
): OrphanReport {
  const limit = now.getTime() - graceDays * 24 * 60 * 60 * 1000;
  const report: OrphanReport = { files: 0, referenced: 0, orphans: [], recent: 0, byKind: { receipt: 0, settlement: 0 }, orphanBytes: 0 };
  for (const file of files) {
    const kind = photoKind(file.path);
    if (!kind) continue;
    report.files++;
    if (referenced.has(file.path)) {
      report.referenced++;
    } else if (file.updated.getTime() > limit) {
      report.recent++;
    } else {
      report.orphans.push(file);
      report.byKind[kind]++;
      report.orphanBytes += file.size;
    }
  }
  return report;
}
