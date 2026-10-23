/**
 * Marca única de `everConfirmed: true` nos gastos lançados antes da marca
 * (v0.7.6): gasto que já foi confirmado só sai pelo pedido de exclusão.
 *
 * Uso (Node 24+, logado na CLI do Firebase como dono do projeto):
 *   node --experimental-transform-types scripts/admin/marcar-confirmados.ts            # simulação: não grava nada
 *   node --experimental-transform-types scripts/admin/marcar-confirmados.ts --gravar   # grava (só com confirmação)
 *
 * - Projeto fixo: acerto-do-casal (nunca outro).
 * - Saída só com contagens: nenhuma descrição, valor ou id aparece.
 * - Marca o que dá para saber que já foi confirmado: o que está confirmado
 *   agora e o devolvido por contestação (só se contesta um confirmado).
 *   Não dá para saber: pendente que foi confirmado e depois editado antes da
 *   marca (a edição apagou a aprovação), devolvido por recusa e "a confirmar".
 * - Grava só o campo `everConfirmed`, e só se o gasto não mudou desde a leitura
 *   (precondição pelo horário da última gravação).
 */
import { createRequire } from 'node:module';

const PROJECT = 'acerto-do-casal';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;
const write = process.argv.includes('--gravar');

// Credencial do dono, pelo login da CLI do Firebase (a mesma usada no deploy).
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { configstore } = require('firebase-tools/lib/configstore');
const { access_token: token } = await auth.getAccessToken(configstore.get('tokens').refresh_token, []);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

type Value = { stringValue?: string; booleanValue?: boolean; mapValue?: { fields?: Record<string, Value> } };
interface Doc {
  name: string;
  updateTime: string;
  fields?: Record<string, Value>;
}

async function list(path: string): Promise<Doc[]> {
  const out: Doc[] = [];
  let page = '';
  do {
    const res = await fetch(`${BASE}/${path}?pageSize=300${page ? `&pageToken=${page}` : ''}`, { headers });
    const json = (await res.json()) as { documents?: Doc[]; nextPageToken?: string; error?: { message: string } };
    if (json.error) throw new Error(`Falha ao ler ${path}: ${json.error.message}`);
    out.push(...(json.documents ?? []));
    page = json.nextPageToken ?? '';
  } while (page);
  return out;
}

const counts = { total: 0, marked: 0, confirmed: 0, contested: 0, unknown: 0, written: 0, failed: 0 };
const toMark: Doc[] = [];

for (const g of await list('groups')) {
  const groupId = g.name.split('/').pop()!;
  for (const e of await list(`groups/${groupId}/expenses`)) {
    counts.total++;
    const f = e.fields ?? {};
    if (f.everConfirmed?.booleanValue === true) {
      counts.marked++;
      continue;
    }
    const status = f.status?.stringValue;
    const contested = status === 'returned' && f.rejection?.mapValue?.fields?.kind?.stringValue === 'contest';
    if (status === 'confirmed') counts.confirmed++;
    else if (contested) counts.contested++;
    else {
      counts.unknown++;
      continue;
    }
    toMark.push(e);
  }
}

if (write) {
  for (const e of toMark) {
    const body = {
      writes: [
        {
          update: { name: e.name, fields: { everConfirmed: { booleanValue: true } } },
          updateMask: { fieldPaths: ['everConfirmed'] },
          currentDocument: { updateTime: e.updateTime },
        },
      ],
    };
    const res = await fetch(`${BASE}:commit`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) counts.written++;
    else counts.failed++;
  }
}

console.log(`modo: ${write ? 'GRAVAÇÃO' : 'simulação (nada gravado)'}`);
console.log(`gastos: ${counts.total}`);
console.log(`  já com a marca: ${counts.marked}`);
console.log(`  a marcar: ${toMark.length}`);
console.log(`    confirmados agora: ${counts.confirmed}`);
console.log(`    devolvidos por contestação: ${counts.contested}`);
console.log(`  sem como saber (pendentes, recusados, a confirmar): ${counts.unknown}`);
if (write) console.log(`  gravados agora: ${counts.written}${counts.failed ? ` (falharam: ${counts.failed}; o gasto mudou: rode de novo)` : ''}`);
