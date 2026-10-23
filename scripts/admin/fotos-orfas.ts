/**
 * Fotos órfãs no Storage: a mesma regra da varredura semanal
 * (`cleanOrphanPhotos`), para a primeira limpeza com conferência.
 *
 * Uso (Node 24+, logado na CLI do Firebase como dono do projeto):
 *   node --experimental-transform-types scripts/admin/fotos-orfas.ts            # simulação: não apaga nada
 *   node --experimental-transform-types scripts/admin/fotos-orfas.ts --apagar   # apaga (só com confirmação)
 *
 * - Projeto e bucket fixos: acerto-do-casal (nunca outro).
 * - Saída só com contagens e bytes: nenhum caminho, id ou foto aparece.
 * - Apaga só comprovantes que nenhum gasto nem pagamento registrado usa e com
 *   mais de 7 dias desde a última gravação. O bucket guarda os arquivos
 *   apagados por 7 dias (soft delete).
 */
import { createRequire } from 'node:module';
import { expensePhotoPath, monthPhotoPaths, orphanPhotos, type StoredFile } from '../../functions/src/photos.ts';

const PROJECT = 'acerto-do-casal';
const BUCKET = 'acerto-do-casal.firebasestorage.app';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const STORAGE = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const remove = process.argv.includes('--apagar');

// Credencial do dono, pelo login da CLI do Firebase (a mesma usada no deploy).
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { configstore } = require('firebase-tools/lib/configstore');
const { access_token: token } = await auth.getAccessToken(configstore.get('tokens').refresh_token, []);
const headers = { Authorization: `Bearer ${token}` };

type Value = { stringValue?: string; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> } };
interface Doc {
  name: string;
  fields?: Record<string, Value>;
}

/** Valor da API REST do Firestore → JS (só o que a regra lê: textos, listas e mapas). */
function plain(v: Value | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(plain);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return null;
}

async function listDocs(path: string): Promise<Doc[]> {
  const out: Doc[] = [];
  let page = '';
  do {
    const res = await fetch(`${DOCS}/${path}?pageSize=300${page ? `&pageToken=${page}` : ''}`, { headers });
    const json = (await res.json()) as { documents?: Doc[]; nextPageToken?: string; error?: { message: string } };
    if (json.error) throw new Error(`Falha ao ler ${path}: ${json.error.message}`);
    out.push(...(json.documents ?? []));
    page = json.nextPageToken ?? '';
  } while (page);
  return out;
}

// 1. Arquivos (antes das referências: uma foto enviada no meio fica pelo prazo).
const files: StoredFile[] = [];
let page = '';
do {
  const url = `${STORAGE}?prefix=groups/&fields=items(name,size,updated),nextPageToken${page ? `&pageToken=${page}` : ''}`;
  const json = (await (await fetch(url, { headers })).json()) as {
    items?: Array<{ name: string; size: string; updated: string }>;
    nextPageToken?: string;
    error?: { message: string };
  };
  if (json.error) throw new Error(`Falha ao listar o Storage: ${json.error.message}`);
  for (const o of json.items ?? []) files.push({ path: o.name, updated: new Date(o.updated), size: Number(o.size) });
  page = json.nextPageToken ?? '';
} while (page);

// 2. Referências: fotos dos gastos e comprovantes dos pagamentos registrados.
const referenced = new Set<string>();
for (const g of await listDocs('groups')) {
  const groupId = g.name.split('/').pop()!;
  for (const e of await listDocs(`groups/${groupId}/expenses`)) {
    const path = expensePhotoPath({ receipt: plain(e.fields?.receipt) as { photoPath?: unknown } });
    if (path) referenced.add(path);
  }
  for (const m of await listDocs(`groups/${groupId}/months`)) {
    for (const path of monthPhotoPaths({ payments: plain(m.fields?.payments) })) referenced.add(path);
  }
}

const report = orphanPhotos(files, referenced, new Date());

let deleted = 0;
let failed = 0;
if (remove) {
  for (const f of report.orphans) {
    const res = await fetch(`${STORAGE}/${encodeURIComponent(f.path)}`, { method: 'DELETE', headers });
    if (res.ok || res.status === 404) deleted++;
    else failed++;
  }
}

const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
console.log(`modo: ${remove ? 'APAGAR' : 'simulação (nada apagado)'}`);
console.log(`arquivos de comprovante: ${report.files}`);
console.log(`  usados por gasto ou pagamento: ${report.referenced}`);
console.log(`  órfãos dentro do prazo de 7 dias (ficam): ${report.recent}`);
console.log(`  órfãos a apagar: ${report.orphans.length} (${kb(report.orphanBytes)})`);
console.log(`    fotos de recibo ou da nota: ${report.byKind.receipt}`);
console.log(`    comprovantes PIX sem pagamento: ${report.byKind.settlement}`);
if (remove) console.log(`  apagados agora: ${deleted}${failed ? ` (falharam: ${failed})` : ''}`);
