/**
 * Reconsulta única dos itens das NFC-e de SP conferidas antes do bloco C da
 * Fase 7 (a `checkNfce` só passou a gravar os itens depois do deploy).
 *
 * Uso (Node 24+, VPN DESLIGADA, logado na CLI do Firebase como dono do projeto):
 *   node --experimental-transform-types scripts/admin/reconsultar-itens.ts            # simulação: não grava nada
 *   node --experimental-transform-types scripts/admin/reconsultar-itens.ts --gravar   # grava (só com confirmação)
 *
 * - Projeto fixo: acerto-do-casal (nunca outro).
 * - Saída só com contagens: nenhum item, valor, loja, chave ou id aparece.
 * - Grava `groups/{g}/nfceItems/{chave}` com `source: 'backfill'`, só se o
 *   documento ainda não existir (nunca sobrescreve o que a Function gravou).
 */
import { createRequire } from 'node:module';
import { parseItems, parsePage, spConsultUrl, type NfceItems } from '../../functions/src/nfce.ts';

const PROJECT = 'acerto-do-casal';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const write = process.argv.includes('--gravar');

// Credencial do dono, pelo login da CLI do Firebase (a mesma usada no deploy).
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { configstore } = require('firebase-tools/lib/configstore');
const { access_token: token } = await auth.getAccessToken(configstore.get('tokens').refresh_token, []);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** Valor JS → formato da API REST do Firestore. */
function toValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

// 1. Gastos de todos os grupos, filtrados aqui: um filtro por campo em todas as
// coleções "expenses" exigiria um índice de grupo de coleções que o projeto não tem.
const query = { structuredQuery: { from: [{ collectionId: 'expenses', allDescendants: true }] } };
const rows = (await (await fetch(`${BASE}:runQuery`, { method: 'POST', headers, body: JSON.stringify(query) })).json()) as Array<{
  document?: { name: string; fields: Record<string, { mapValue?: { fields: Record<string, { stringValue?: string }> } }> };
}>;
if (!Array.isArray(rows)) throw new Error('A consulta aos gastos falhou.');

// Uma consulta por nota (a mesma chave numa série vale para todas as parcelas).
const notes = new Map<string, { groupId: string; key: string }>();
for (const { document: d } of rows) {
  if (!d) continue;
  const groupId = d.name.split('/groups/')[1]?.split('/')[0];
  const receipt = d.fields.receipt?.mapValue?.fields;
  const key = receipt?.nfceKey?.stringValue;
  const conferred = receipt?.type?.stringValue === 'nfce' && receipt.nfceStatus?.stringValue === 'ok';
  if (groupId && key && conferred && spConsultUrl(key)) notes.set(`${groupId}/${key}`, { groupId, key });
}

let already = 0;
let read = 0;
let consistent = 0;
let failed = 0;
let written = 0;
const toWrite: Array<{ groupId: string; key: string; items: NfceItems }> = [];

for (const { groupId, key } of notes.values()) {
  const itemsDoc = `${BASE}/groups/${groupId}/nfceItems/${key}`;
  if ((await fetch(itemsDoc, { headers })).status === 200) {
    already++;
    continue;
  }
  try {
    const res = await fetch(spConsultUrl(key)!, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    const page = parsePage(html);
    const items = page.error || page.totalCents === undefined ? null : parseItems(html);
    if (!items || items.totalCents !== page.totalCents) {
      failed++;
      continue;
    }
    read++;
    if (items.consistent) consistent++;
    toWrite.push({ groupId, key, items });
  } catch {
    failed++;
  }
}

if (write) {
  for (const { groupId, key, items } of toWrite) {
    const body = {
      writes: [
        {
          update: {
            name: `projects/${PROJECT}/databases/(default)/documents/groups/${groupId}/nfceItems/${key}`,
            fields: (toValue({ ...items, source: 'backfill' }) as { mapValue: { fields: unknown } }).mapValue.fields,
          },
          updateTransforms: [{ fieldPath: 'fetchedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        },
      ],
    };
    const res = await fetch(`${BASE}:commit`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) written++;
  }
}

console.log(`modo: ${write ? 'GRAVAÇÃO' : 'simulação (nada gravado)'}`);
console.log(`notas de SP conferidas: ${notes.size}`);
console.log(`  já com itens (pula): ${already}`);
console.log(`  a reconsultar: ${notes.size - already}`);
console.log(`    itens lidos: ${read} (soma bate: ${consistent}, soma não bate: ${read - consistent})`);
console.log(`    sem itens ou SEFAZ não respondeu: ${failed}`);
if (write) console.log(`  gravados agora: ${written}`);
