/**
 * Registro único das notas fiscais lançadas antes do bloqueio de nota repetida
 * (`groups/{g}/fiscalKeys/{chave}`), e lista das notas lançadas mais de uma vez.
 *
 * Uso (Node 24+, logado na CLI do Firebase como dono do projeto):
 *   node --experimental-transform-types scripts/admin/registrar-notas.ts            # simulação: não grava nada
 *   node --experimental-transform-types scripts/admin/registrar-notas.ts --gravar   # grava (só com confirmação)
 *
 * - Projeto fixo: acerto-do-casal (nunca outro).
 * - Saída: contagens e, para cada nota repetida, quais gastos (id, data,
 *   competência, quem lançou, valor, mês aberto ou fechado). A chave aparece
 *   só pelos 4 últimos dígitos; descrição e loja não aparecem.
 * - Uma série conta como um gasto (o registro aponta para a parcela 1).
 * - Nota repetida: o registro aponta para o gasto lançado primeiro; os outros
 *   continuam como estão (editáveis e excluíveis) até a decisão de quem usa.
 * - Grava só registros que ainda não existem (nunca sobrescreve).
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

type Value = {
  stringValue?: string;
  integerValue?: string;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, Value> };
  arrayValue?: { values?: Value[] };
};
interface Doc {
  name: string;
  fields?: Record<string, Value>;
}

/** Todos os documentos de uma coleção (com paginação). */
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

const idOf = (d: Doc) => d.name.split('/').pop()!;
const str = (v?: Value) => v?.stringValue;

interface Owner {
  /** Gasto dono do registro: o próprio gasto ou, numa série, a parcela 1. */
  ownerId: string;
  createdBy: string;
  createdAt: string;
  date: string;
  competence: string;
  /** Valor do gasto ou, numa série, o total da compra. */
  cents: number;
  parcels: number;
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let groupsCount = 0;
let withKey = 0;
let distinct = 0;
let already = 0;
let toCreate = 0;
let written = 0;
let failedWrites = 0;
const duplicates: string[] = [];
const writes: Array<{ groupId: string; key: string; owner: Owner }> = [];

for (const g of await list('groups')) {
  groupsCount++;
  const groupId = idOf(g);
  const names = g.fields?.memberNames?.mapValue?.fields ?? {};
  const firstName = (uid: string) => (str(names[uid]) ?? '').trim().split(/\s+/)[0] || 'membro fora do grupo';
  const closed = new Set(
    (await list(`groups/${groupId}/months`)).filter((m) => str(m.fields?.status) === 'closed').map(idOf),
  );
  const registered = new Set((await list(`groups/${groupId}/fiscalKeys`)).map(idOf));

  // Chave → gastos donos (uma série vira um só, pela parcela 1 ou a primeira encontrada).
  const byKey = new Map<string, Map<string, Owner>>();
  for (const e of await list(`groups/${groupId}/expenses`)) {
    const f = e.fields ?? {};
    const receipt = f.receipt?.mapValue?.fields ?? {};
    const key = str(receipt.nfceKey);
    if (str(receipt.type) !== 'nfce' || !key) continue;
    withKey++;
    const inst = f.installment?.mapValue?.fields;
    const ownerId = str(inst?.seriesId) ?? idOf(e);
    const owners = byKey.get(key) ?? new Map<string, Owner>();
    byKey.set(key, owners);
    const known = owners.get(ownerId);
    if (known) {
      known.parcels++;
      if (idOf(e) !== ownerId) continue; // a parcela 1 define data e competência
    }
    owners.set(ownerId, {
      ownerId,
      createdBy: str(f.createdBy) ?? '',
      createdAt: f.createdAt?.timestampValue ?? '',
      date: str(f.date) ?? '',
      competence: str(f.competence) ?? '',
      cents: Number(inst?.purchaseCents?.integerValue ?? f.totalCents?.integerValue ?? 0),
      parcels: known?.parcels ?? 1,
    });
  }

  for (const [key, owners] of byKey) {
    distinct++;
    const sorted = [...owners.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sorted.length > 1) {
      duplicates.push(`nota …${key.slice(-4)} (grupo ${groupsCount}): ${sorted.length} lançamentos${registered.has(key) ? ', registro já existe' : ''}`);
      for (const [i, o] of sorted.entries()) {
        duplicates.push(
          `  ${i === 0 && !registered.has(key) ? '* ' : '  '}${o.ownerId}${o.parcels > 1 ? ` (série, ${o.parcels} parcelas)` : ''} · ${o.date} · competência ${o.competence} (${closed.has(o.competence) ? 'fechado' : 'aberto'}) · ${firstName(o.createdBy)} · ${brl(o.cents)}`,
        );
      }
    }
    if (registered.has(key)) {
      already++;
      continue;
    }
    toCreate++;
    writes.push({ groupId, key, owner: sorted[0] });
  }
}

if (write) {
  for (const { groupId, key, owner } of writes) {
    const body = {
      writes: [
        {
          update: {
            name: `${DOCS}/groups/${groupId}/fiscalKeys/${key}`,
            fields: { expenseId: { stringValue: owner.ownerId }, createdBy: { stringValue: owner.createdBy } },
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: false },
        },
      ],
    };
    const res = await fetch(`${BASE}:commit`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) written++;
    else failedWrites++;
  }
}

console.log(`modo: ${write ? 'GRAVAÇÃO' : 'simulação (nada gravado)'}`);
console.log(`grupos: ${groupsCount}`);
console.log(`gastos com chave (cada parcela conta): ${withKey}`);
console.log(`notas distintas: ${distinct}`);
console.log(`  já registradas (pula): ${already}`);
console.log(`  a registrar: ${toCreate}`);
if (write) console.log(`  gravadas agora: ${written}${failedWrites ? ` (falharam: ${failedWrites})` : ''}`);
console.log(`notas lançadas mais de uma vez: ${duplicates.filter((l) => l.startsWith('nota')).length}`);
if (duplicates.length > 0) {
  console.log('(* = gasto que fica com o registro: o lançado primeiro)');
  for (const line of duplicates) console.log(line);
}
