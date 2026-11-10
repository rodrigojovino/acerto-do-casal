/**
 * Cancelamento administrativo de um pagamento do acerto registrado por engano
 * (por exemplo, com o comprovante PIX errado) num mês ainda aberto. Uso único,
 * pelo dono, enquanto o app não tem o "Cancelar pagamento" (v0.9.3).
 *
 * Uso (Node 24+, logado na CLI do Firebase como dono do projeto):
 *   node --experimental-transform-types scripts/admin/cancelar-pagamento.ts --project acerto-do-casal --mes 2026-10
 *       simulação: lista os pagamentos do mês (id, valor, método, quem registrou, quando); não grava nada
 *   node --experimental-transform-types scripts/admin/cancelar-pagamento.ts --project acerto-do-casal --mes 2026-10 --cancelar <id>
 *       [--motivo "texto"]   grava (só com confirmação explícita do Rodrigo, depois de ver a simulação)
 *
 * - Projeto fixo: acerto-do-casal; o --project é obrigatório e precisa ser esse.
 * - Nunca mostra o caminho da foto do comprovante nem dados de notas.
 * - Recusa: mês fechado; pagamento de um fechamento anterior (registrado antes
 *   da última reabertura); id que não está na lista.
 * - Grava num lote só, e só se o documento do mês não mudou desde a leitura
 *   (precondição pelo horário da última gravação): a lista de pagamentos sem
 *   esse pagamento e um registro em groups/{g}/months/{mês}/log (cancelamento
 *   administrativo: quando, valor, método, quem tinha registrado; sem a foto).
 *   O valor que falta volta ao saldo; a foto do PIX fica no Storage e sai na
 *   varredura semanal de fotos órfãs (cleanOrphanPhotos), depois de 7 dias.
 * - Com mais de um grupo no projeto, exige --grupo <id>.
 */
import { createRequire } from 'node:module';

const PROJECT = 'acerto-do-casal';
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

if (arg('--project') !== PROJECT) {
  console.error(`Informe --project ${PROJECT} (o único projeto aceito).`);
  process.exit(1);
}
const month = arg('--mes');
if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
  console.error('Informe o mês: --mes AAAA-MM.');
  process.exit(1);
}
const cancelId = arg('--cancelar');
const reason = (arg('--motivo') ?? 'Cancelamento administrativo').trim().slice(0, 200);
if (process.argv.includes('--cancelar') && !cancelId) {
  console.error('Informe o id do pagamento: --cancelar <id> (veja a simulação).');
  process.exit(1);
}

const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;

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
  updateTime: string;
  fields?: Record<string, Value>;
}

async function get(path: string): Promise<Doc | null> {
  const res = await fetch(`${BASE}/${path}`, { headers });
  if (res.status === 404) return null;
  const json = (await res.json()) as Doc & { error?: { message: string } };
  if (json.error) throw new Error(`Falha ao ler ${path}: ${json.error.message}`);
  return json;
}

// ---- Grupo ----
let groupId = arg('--grupo');
if (!groupId) {
  const res = await fetch(`${BASE}/groups?pageSize=10&mask.fieldPaths=members`, { headers });
  const groups = ((await res.json()) as { documents?: Doc[] }).documents ?? [];
  if (groups.length !== 1) {
    console.error(`Há ${groups.length} grupos no projeto: informe --grupo <id>.`);
    process.exit(1);
  }
  groupId = groups[0].name.split('/').pop()!;
}
const group = await get(`groups/${groupId}`);
if (!group) {
  console.error('Grupo não encontrado.');
  process.exit(1);
}
const names = group.fields?.memberNames?.mapValue?.fields ?? {};
const firstName = (uid: string | undefined) => (uid ? (names[uid]?.stringValue ?? '?').trim().split(/\s+/)[0] : '?');

// ---- Mês e pagamentos ----
const monthPath = `groups/${groupId}/months/${month}`;
const monthDoc = await get(monthPath);
const status = monthDoc?.fields?.status?.stringValue ?? 'open';
const reopenedAt = monthDoc?.fields?.reopenedAt?.timestampValue ?? null;
const payments = monthDoc?.fields?.payments?.arrayValue?.values ?? [];

const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100).replace(/\s/g, ' ');
const when = (iso: string | undefined) =>
  iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '?';

interface Row {
  id: string;
  cents: number;
  method: string;
  byUid: string;
  fromUid: string;
  toUid: string;
  at: string | undefined;
  /** Registrado antes da última reabertura: pertence a um fechamento anterior. */
  previousClosing: boolean;
}
const rows: Row[] = payments.map((v) => {
  const f = v.mapValue?.fields ?? {};
  const at = f.at?.timestampValue;
  return {
    id: f.id?.stringValue ?? '?',
    cents: Number(f.amountCents?.integerValue ?? 0),
    method: f.method?.stringValue === 'pix' ? 'PIX' : f.method?.stringValue === 'cash' ? 'dinheiro' : (f.method?.stringValue ?? '?'),
    byUid: f.byUid?.stringValue ?? '',
    fromUid: f.fromUid?.stringValue ?? '',
    toUid: f.toUid?.stringValue ?? '',
    at,
    previousClosing: !!reopenedAt && !!at && Date.parse(at) <= Date.parse(reopenedAt),
  };
});

console.log(`modo: ${cancelId ? 'GRAVAÇÃO' : 'simulação (nada gravado)'}`);
console.log(`mês ${month}: ${status === 'closed' ? 'FECHADO' : 'aberto'}${reopenedAt ? ` (reaberto em ${when(reopenedAt)})` : ''}`);
console.log(`pagamentos registrados: ${rows.length}`);
for (const r of rows) {
  console.log(
    `  ${r.id} · ${brl(r.cents)} · ${r.method} · de ${firstName(r.fromUid)} para ${firstName(r.toUid)} · registrado por ${firstName(r.byUid)} em ${when(r.at)}` +
      (r.previousClosing ? ' · de um fechamento anterior (não pode ser cancelado)' : ''),
  );
}

if (!cancelId) process.exit(0);

// ---- Cancelamento ----
const target = rows.find((r) => r.id === cancelId);
if (!monthDoc || status === 'closed') {
  console.error('Recusado: o mês está fechado (precisa ser reaberto antes).');
  process.exit(1);
}
if (!target) {
  console.error(`Recusado: não há pagamento com o id ${cancelId} neste mês.`);
  process.exit(1);
}
if (target.previousClosing) {
  console.error('Recusado: o pagamento pertence a um fechamento anterior (registrado antes da reabertura).');
  process.exit(1);
}

const remaining = payments.filter((v) => v.mapValue?.fields?.id?.stringValue !== cancelId);
const logId = `cancel-${cancelId}`;
const body = {
  writes: [
    {
      update: { name: `${DOCS}/${monthPath}`, fields: { payments: { arrayValue: remaining.length > 0 ? { values: remaining } : {} } } },
      updateMask: { fieldPaths: ['payments'] },
      currentDocument: { updateTime: monthDoc.updateTime },
    },
    {
      update: {
        name: `${DOCS}/${monthPath}/log/${logId}`,
        fields: {
          type: { stringValue: 'payment_cancelled' },
          by: { stringValue: 'admin' },
          paymentId: { stringValue: target.id },
          amountCents: { integerValue: String(target.cents) },
          method: { stringValue: payments.find((v) => v.mapValue?.fields?.id?.stringValue === cancelId)?.mapValue?.fields?.method?.stringValue ?? '' },
          fromUid: { stringValue: target.fromUid },
          toUid: { stringValue: target.toUid },
          registeredBy: { stringValue: target.byUid },
          ...(target.at ? { registeredAt: { timestampValue: target.at } } : {}),
          reason: { stringValue: reason },
        },
      },
      currentDocument: { exists: false },
    },
    {
      transform: {
        document: `${DOCS}/${monthPath}/log/${logId}`,
        fieldTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
      },
    },
  ],
};
const res = await fetch(`${BASE}:commit`, { method: 'POST', headers, body: JSON.stringify(body) });
if (!res.ok) {
  const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
  console.error(
    err.error?.status === 'FAILED_PRECONDITION'
      ? 'Não gravado: o mês mudou desde a leitura. Rode a simulação de novo.'
      : `Não gravado: ${err.error?.message ?? res.statusText}`,
  );
  process.exit(1);
}
console.log(`Cancelado: ${target.id} · ${brl(target.cents)} · ${target.method}. Restam ${remaining.length} pagamento(s) no mês.`);
