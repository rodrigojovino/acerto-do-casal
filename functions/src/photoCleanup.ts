import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { expensePhotoPath, monthPhotoPaths, orphanPhotos, type OrphanReport, type StoredFile } from './photos.js';

if (getApps().length === 0) initializeApp();

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

/** Caminhos de comprovante que algum gasto ou pagamento registrado usa, em todos os grupos. */
export async function referencedPhotoPaths(db: Firestore): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const group of (await db.collection('groups').get()).docs) {
    const [expenses, months] = await Promise.all([group.ref.collection('expenses').get(), group.ref.collection('months').get()]);
    for (const e of expenses.docs) {
      const path = expensePhotoPath(e.data());
      if (path) paths.add(path);
    }
    for (const m of months.docs) for (const path of monthPhotoPaths(m.data())) paths.add(path);
  }
  return paths;
}

/** Bucket do projeto (`name` só nos testes, no emulador). */
const bucketOf = (name?: string): Bucket => getStorage().bucket(name);

/** Arquivos guardados em `groups/` (as pastas de comprovante são filtradas por `orphanPhotos`). */
export async function storedFiles(bucketName?: string): Promise<StoredFile[]> {
  const [files] = await bucketOf(bucketName).getFiles({ prefix: 'groups/' });
  return files.map((f) => ({
    path: f.name,
    updated: new Date(f.metadata.updated ?? f.metadata.timeCreated ?? 0),
    size: Number(f.metadata.size ?? 0),
  }));
}

/**
 * Varredura das fotos órfãs. As referências são lidas depois da lista de
 * arquivos: uma foto enviada no meio da varredura é recente e fica pelo prazo.
 * `remove`: apaga os órfãos fora do prazo; sem ele, só conta (simulação).
 */
export async function cleanOrphans(
  now: Date,
  remove: boolean,
  bucketName?: string,
  db: Firestore = getFirestore(),
): Promise<OrphanReport & { deleted: number }> {
  const bucket = bucketOf(bucketName);
  const files = await storedFiles(bucketName);
  const report = orphanPhotos(files, await referencedPhotoPaths(db), now);
  let deleted = 0;
  if (remove) {
    for (const f of report.orphans) {
      // Já apagado por outra execução: não é erro.
      await bucket.file(f.path).delete({ ignoreNotFound: true });
      deleted++;
    }
  }
  return { ...report, deleted };
}

/** Domingo às 4h (São Paulo): apaga as fotos órfãs com mais de 7 dias. Só contagens no log. */
export const cleanOrphanPhotos = onSchedule(
  { schedule: '0 4 * * 0', timeZone: 'America/Sao_Paulo', timeoutSeconds: 300 },
  async () => {
    const r = await cleanOrphans(new Date(), true);
    logger.info('fotos órfãs', {
      files: r.files,
      referenced: r.referenced,
      recent: r.recent,
      deleted: r.deleted,
      receipts: r.byKind.receipt,
      settlements: r.byKind.settlement,
      bytes: r.orphanBytes,
    });
  },
);
