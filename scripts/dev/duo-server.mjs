// Servidor de cenários do ambiente de dois aparelhos (npm run dev:duo).
// Fala SÓ com os emuladores: recusa iniciar sem as variáveis dos emuladores
// (Firestore, Auth e Storage em localhost/127.0.0.1) ou com um projeto que não
// comece com "demo-". Nunca toca a produção.
//
// Rotas (CORS liberado, só para a página duo local):
//   GET  /status                 projeto e saúde
//   GET  /token/:who             token de login do aparelho (rodrigo | queila)
//   POST /scenario/:name         zerar | casal | todos-estados | fechamento | recorrentes-dia1
//   GET  /outbox                 avisos que cada pessoa receberia (notificationOutbox)
//   GET  /balance?month=YYYY-MM  saldo do mês calculado aqui, com a mesma função do app
//   GET  /keys                   chaves das NFC-e de teste (para digitar no formulário)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// ---- Trava: só emuladores, só projeto demo- ----
const LOCAL = /^(localhost|127\.0\.0\.1):\d+$/;
const required = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'GCLOUD_PROJECT'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[duo] Recusado: faltam as variáveis dos emuladores (${missing.join(', ')}). Use npm run dev:duo.`);
  process.exit(1);
}
for (const k of required.slice(0, 3)) {
  if (!LOCAL.test(process.env[k])) {
    console.error(`[duo] Recusado: ${k}=${process.env[k]} não é um emulador local.`);
    process.exit(1);
  }
}
const PROJECT = process.env.GCLOUD_PROJECT;
if (!PROJECT.startsWith('demo-')) {
  console.error(`[duo] Recusado: o projeto "${PROJECT}" não começa com "demo-".`);
  process.exit(1);
}
process.env.FIREBASE_CONFIG ||= JSON.stringify({ projectId: PROJECT });

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const fnRequire = createRequire(join(repo, 'functions', 'package.json'));
const lib = (p) => pathToFileURL(join(repo, 'functions', 'lib', p)).href;

const { getApps, initializeApp } = await import(pathToFileURL(fnRequire.resolve('firebase-admin/app')).href);
const { getAuth } = await import(pathToFileURL(fnRequire.resolve('firebase-admin/auth')).href);
const { FieldValue, Timestamp, getFirestore } = await import(pathToFileURL(fnRequire.resolve('firebase-admin/firestore')).href);
if (getApps().length === 0) initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const { monthBalance } = await import(lib('src/domain/settlement.js'));
const { checkDigit, spConsultUrl } = await import(lib('functions/src/nfce.js'));

const PORT = 5180;

// ---- Pessoas e meses ----
export const PEOPLE = {
  rodrigo: { uid: 'dev-rodrigo', name: 'Rodrigo' },
  queila: { uid: 'dev-queila', name: 'Queila' },
};
const R = PEOPLE.rodrigo.uid;
const Q = PEOPLE.queila.uid;
const GROUP = 'grupoDuo01'; // só letras e números: as Functions de fechamento conferem o id (ID_RE)

function spToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
const day = (month, d) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const months = () => {
  const current = spToday().slice(0, 7);
  return { current, prev: addMonths(current, -1), next: addMonths(current, 1), created: addMonths(current, -3) };
};

// ---- NFC-e de teste (fictícias; o emulador nunca consulta a SEFAZ) ----
const CNPJ = '11222333000181';
function key(uf, model, serial, month) {
  const yymm = month.slice(2, 4) + month.slice(5, 7);
  const base = `${uf}${yymm}${CNPJ}${model}001${String(serial).padStart(18, '0')}`;
  return base + checkDigit(base);
}
function testKeys() {
  const { current } = months();
  return {
    itens: key('35', '65', 101, current), // NFC-e de SP com 8 itens
    barrada: key('35', '65', 102, current), // NFC-e de SP: página de bloqueio do filtro
    mercado: key('35', '65', 103, current), // a nota do Mercado do cenário (já conferida)
    nfe: key('35', '55', 104, current), // NF-e (sem consulta)
    mg: key('31', '65', 105, current), // NFC-e de MG (sem consulta)
    luz: key('35', '55', 106, current), // NF-e da conta de luz do cenário
    geladeira: key('31', '65', 107, current), // NFC-e de MG da compra parcelada
  };
}
const ITEMS_8 = [
  ['ARROZ TIPO 1 5KG', '1', 'UN', '27,90'],
  ['FEIJAO CARIOCA 1KG', '2', 'UN', '8,49'],
  ['CAFE TORRADO 500G', '1', 'UN', '18,90'],
  ['SABONETE LIQUIDO 250ML', '1', 'UN', '12,50'],
  ['SHAMPOO 400ML', '1', 'UN', '24,90'],
  ['BANANA PRATA KG', '1,235', 'KG', '6,99'],
  ['IOGURTE NATURAL 170G', '4', 'UN', '3,29'],
  ['RACAO GATO 1KG', '1', 'UN', '32,90'],
];
const cents = (t) => Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100);
const brl = (c) => (c / 100).toFixed(2).replace('.', ',');
function sefazPage(items, discountCents, date) {
  const rows = items
    .map(([name, qty, unit, price], i) => {
      const total = Math.round(Number(qty.replace(',', '.')) * cents(price));
      return `<tr id="Item + ${i + 1}"><td valign="top"><span class="txtTit">${name}</span>
        <span class="RCod"> (Código: ${1000 + i} ) </span><br>
        <span class="Rqtd"> <strong>Qtde.:</strong>${qty}</span><span class="RUN"> <strong>UN: </strong>${unit}</span>
        <span class="RvlUnit"> <strong>Vl. Unit.:</strong> ${price}</span></td>
        <td class="txtTit noWrap"> Vl. Total <br><span class="valor">${brl(total)}</span></td></tr>`;
    })
    .join('');
  const gross = items.reduce((s, [, qty, , price]) => s + Math.round(Number(qty.replace(',', '.')) * cents(price)), 0);
  const payable = gross - discountCents;
  const [y, m, d] = date.split('-');
  return {
    payable,
    html: `<html><body>
      <div id="u20" class="txtTopo">MERCADO DUO TESTE LTDA</div>
      <div class="text">CNPJ: 11.222.333/0001-81</div>
      <table id="tabResult" class="filterable">${rows}</table>
      <div id="totalNota" class="txtRight">
        <div id="linhaTotal"><label>Valor total R$:</label><span class="totalNumb">${brl(gross)}</span></div>
        <div id="linhaTotal"><label>Descontos R$:</label><span class="totalNumb">${brl(discountCents)}</span></div>
        <div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">${brl(payable)}</span></div>
        <div id="linhaForma"><label>Forma de pagamento:</label><span class="totalNumb txtTitR">Valor pago R$:</span></div>
        <div id="linhaTotal"><label class="tx"> Pix </label><span class="totalNumb">${brl(payable)}</span></div>
      </div>
      <li><strong>Emissão: </strong>${d}/${m}/${y} 11:56:22 - Via Consumidor</li>
    </body></html>`,
  };
}
const BLOCKED =
  '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.</body></html>';

async function seedFixtures() {
  const k = testKeys();
  const { current } = months();
  const nota = sefazPage(ITEMS_8, 500, day(current, 5));
  const mercado = sefazPage(
    [
      ['CARNE BOVINA KG', '2', 'KG', '45,00'],
      ['CERVEJA LATA 350ML', '12', 'UN', '4,50'],
      ['CARVAO 4KG', '1', 'UN', '22,00'],
      ['PAO DE ALHO', '2', 'UN', '7,00'],
      ['LINGUICA KG', '1', 'KG', '20,00'],
    ],
    0,
    day(current, 3),
  );
  const batch = db.batch();
  batch.set(db.doc(`emulatorFixtures/sefaz_${k.itens}`), { html: nota.html });
  batch.set(db.doc(`emulatorFixtures/sefaz_${k.barrada}`), { html: BLOCKED });
  batch.set(db.doc(`emulatorFixtures/sefaz_${k.mercado}`), { html: mercado.html });
  await batch.commit();
  return { notaPayable: nota.payable, mercadoPayable: mercado.payable };
}

// ---- Limpeza ----
async function resetAll() {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${au}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Espera os gatilhos dos dados semeados terminarem e apaga os avisos deles (a caixa começa limpa). */
async function clearSeedNotices() {
  // Os gatilhos dos avisos rodam depois da gravação (na primeira vez, com a
  // Function ainda "fria", alguns segundos depois): espera chegar algum aviso
  // e a caixa ficar parada por 4 s (no mínimo 10 s, no máximo 40 s).
  const started = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - started < 40_000) {
    const n = (await db.collection('notificationOutbox').count().get()).data().count;
    if (n !== last) {
      last = n;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 4000 && Date.now() - started > 10_000) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const all = await db.collection('notificationOutbox').get();
  await Promise.all(all.docs.map((d) => d.ref.delete()));
}

// ---- Cenários ----
const ts = (date) => Timestamp.fromDate(new Date(`${date}T12:00:00-03:00`));
const CATEGORIES = ['Mercado', 'Contas da casa', 'Restaurantes', 'Saúde', 'Transporte', 'Lazer', 'Casa'];
const catId = (name) => `cat-${CATEGORIES.indexOf(name) + 1}`;

async function seedCouple() {
  const { created } = months();
  for (const p of Object.values(PEOPLE)) {
    await auth.createUser({ uid: p.uid, displayName: p.name, email: `${p.uid}@exemplo.invalid` }).catch(() => undefined);
  }
  const batch = db.batch();
  batch.set(db.doc(`groups/${GROUP}`), {
    members: [R, Q],
    memberNames: { [R]: PEOPLE.rodrigo.name, [Q]: PEOPLE.queila.name },
    defaultSplitPct: 50,
    requireCategory: false,
    inviteCode: null,
    inviteExpiresAt: null,
    createdAt: ts(`${created}-01`),
  });
  batch.set(db.doc(`memberships/${R}`), { groupId: GROUP });
  batch.set(db.doc(`memberships/${Q}`), { groupId: GROUP });
  CATEGORIES.forEach((name, i) =>
    batch.set(db.doc(`groups/${GROUP}/categories/${catId(name)}`), {
      name,
      active: true,
      order: i,
      createdBy: R,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  await batch.commit();
  return seedFixtures();
}

function expense(fields) {
  const date = fields.date;
  return {
    personalCents: 0,
    payerSharePct: 50,
    competence: date.slice(0, 7),
    createdBy: fields.payerUid,
    createdAt: ts(date),
    updatedAt: ts(date),
    receipt: { type: 'none' },
    ...fields,
  };
}
const nfceReceipt = (k, extra = {}) => {
  const url = spConsultUrl(k);
  return url
    ? { type: 'nfce', nfceKey: k, entry: 'qr', nfceUrl: url, nfceStatus: 'pending', ...extra }
    : { type: 'nfce', nfceKey: k, entry: 'typed', nfceStatus: 'unchecked', ...extra };
};

/**
 * Mês atual com gastos em todos os estados. Os valores são os do exemplo de
 * referência do CLAUDE.md (Rodrigo = A, Queila = B): o saldo dá R$ 100,00 de
 * Rodrigo para Queila. O variável a confirmar fica fora do saldo.
 */
async function seedAllStates() {
  const { mercadoPayable } = await seedCouple();
  const { current } = months();
  const k = testKeys();
  const g = (p) => db.doc(`groups/${GROUP}/${p}`);
  const batch = db.batch();

  // Automático: NFC-e de SP conferida, com os itens; Mercado R$ 200,00 com R$ 50,00 pessoais (Rodrigo).
  batch.set(g('expenses/mercado'), expense({
    description: 'Mercado do churrasco', totalCents: 20000, personalCents: 5000, payerUid: R, date: day(current, 3),
    status: 'confirmed', everConfirmed: true, categoryId: catId('Mercado'), note: 'churrasco do sábado',
    receipt: nfceReceipt(k.mercado, { nfceStatus: 'ok', nfceData: { issuerName: 'MERCADO DUO TESTE LTDA', totalCents: mercadoPayable, date: day(current, 3) } }),
  }));
  batch.set(g(`fiscalKeys/${k.mercado}`), { expenseId: 'mercado', createdBy: R, createdAt: ts(day(current, 3)) });

  // Validado: NF-e da conta de luz, R$ 300,00 (Queila), validada por Rodrigo.
  batch.set(g('expenses/luz'), expense({
    description: 'Conta de luz', totalCents: 30000, payerUid: Q, date: day(current, 8), status: 'confirmed', everConfirmed: true,
    categoryId: catId('Contas da casa'), approval: { byUid: R, at: ts(day(current, 9)) }, receipt: nfceReceipt(k.luz),
  }));
  batch.set(g(`fiscalKeys/${k.luz}`), { expenseId: 'luz', createdBy: Q, createdAt: ts(day(current, 8)) });

  // Devolvido: Farmácia R$ 80,00 (Rodrigo), contestada por Queila.
  batch.set(g('expenses/farmacia'), expense({
    description: 'Farmácia', totalCents: 8000, payerUid: R, date: day(current, 10), status: 'returned', everConfirmed: true,
    categoryId: catId('Saúde'), rejection: { byUid: Q, reason: 'Esse remédio foi só seu', at: ts(day(current, 11)), kind: 'contest' },
    receipt: nfceReceipt(k.nfe),
  }));
  batch.set(g(`fiscalKeys/${k.nfe}`), { expenseId: 'farmacia', createdBy: R, createdAt: ts(day(current, 10)) });

  // Pendente: Padaria R$ 36,00 (Queila), sem comprovante.
  batch.set(g('expenses/padaria'), expense({ description: 'Padaria', totalCents: 3600, payerUid: Q, date: day(current, 12), status: 'pending_approval' }));

  // Parcelado: Geladeira R$ 2.140,00 em 10x de R$ 214,00 (Queila), NFC-e de MG, a partir deste mês.
  const seriesId = 'geladeira';
  for (let i = 1; i <= 10; i++) {
    const month = addMonths(current, i - 1);
    batch.set(g(`expenses/${i === 1 ? seriesId : `${seriesId}-${i}`}`), expense({
      description: 'Geladeira', totalCents: 21400, payerUid: Q, date: day(month, 6), status: 'confirmed', everConfirmed: true,
      categoryId: catId('Casa'), receipt: nfceReceipt(k.geladeira),
      installment: { seriesId, index: i, count: 10, firstMonth: current, purchaseCents: 214000 },
    }));
  }
  batch.set(g(`fiscalKeys/${k.geladeira}`), { expenseId: seriesId, createdBy: Q, createdAt: ts(day(current, 6)) });

  // Recorrentes: Internet fixa R$ 120,00 (Rodrigo, aprovada) e Água variável (Queila).
  const rec = (fields) => ({
    payerSharePct: 50, startMonth: addMonths(current, -2), active: true, status: 'approved',
    createdAt: ts(day(addMonths(current, -2), 1)), updatedAt: ts(day(addMonths(current, -2), 1)), ...fields,
  });
  batch.set(g('recurring/internet'), rec({
    description: 'Internet', kind: 'fixed', amountCents: 12000, dayOfMonth: 15, payerUid: R, createdBy: R,
    approval: { byUid: Q, at: ts(day(addMonths(current, -2), 2)) }, categoryId: catId('Contas da casa'),
  }));
  batch.set(g('recurring/agua'), rec({ description: 'Água', kind: 'variable', dayOfMonth: 20, payerUid: Q, createdBy: Q, categoryId: catId('Contas da casa') }));
  await batch.commit();

  // Gerados do recorrente neste mês, pela mesma Function do dia 1.
  const { generateRecurring } = await import(lib('functions/src/recurring.js'));
  await generateRecurring(`${current}-01`, db);
  await db.doc(`groups/${GROUP}/nfceItems/${k.mercado}`).delete().catch(() => undefined);
  await seedMercadoItems(k.mercado, current);
}

/** Itens oficiais do Mercado (como a checkNfce gravaria). */
async function seedMercadoItems(k) {
  const { readNfcePage } = await import(lib('functions/src/nfce.js'));
  const html = (await db.doc(`emulatorFixtures/sefaz_${k}`).get()).get('html');
  const { items } = readNfcePage(spConsultUrl(k), html);
  if (items) await db.doc(`groups/${GROUP}/nfceItems/${k}`).set({ ...items, fetchedAt: FieldValue.serverTimestamp(), source: 'checkNfce' });
}

/** Mês passado pronto para fechar: tudo confirmado; falta registrar o pagamento e fechar no app. */
async function seedClosing() {
  await seedCouple();
  const { prev } = months();
  const batch = db.batch();
  const add = (id, f) => batch.set(db.doc(`groups/${GROUP}/expenses/${id}`), expense({ status: 'confirmed', everConfirmed: true, approval: { byUid: f.payerUid === R ? Q : R, at: ts(f.date) }, ...f }));
  add('f-aluguel', { description: 'Aluguel', totalCents: 250000, payerUid: R, date: day(prev, 5), categoryId: catId('Casa') });
  add('f-mercado', { description: 'Mercado do mês', totalCents: 84250, payerUid: Q, date: day(prev, 9), categoryId: catId('Mercado') });
  add('f-jantar', { description: 'Jantar fora', totalCents: 18990, personalCents: 2500, payerUid: Q, date: day(prev, 18), categoryId: catId('Restaurantes') });
  add('f-uber', { description: 'Uber da festa', totalCents: 4377, payerUid: R, date: day(prev, 22), payerSharePct: 70, categoryId: catId('Transporte') });
  await batch.commit();
}

/** Virada do mês: geração do dia 1 do mês seguinte (recorrentes do cenário "todos os estados"). */
async function generateDay1() {
  const { next } = months();
  const { generateRecurring } = await import(lib('functions/src/recurring.js'));
  return generateRecurring(`${next}-01`, db);
}

const SCENARIOS = {
  zerar: async () => resetAll(),
  casal: async () => {
    await resetAll();
    await seedCouple();
    await clearSeedNotices();
  },
  'todos-estados': async () => {
    await resetAll();
    await seedAllStates();
    await clearSeedNotices();
  },
  fechamento: async () => {
    await resetAll();
    await seedClosing();
    await clearSeedNotices();
  },
  'recorrentes-dia1': async () => generateDay1(),
};

// ---- Consultas da página ----
async function outbox() {
  const snap = await db.collection('notificationOutbox').orderBy('at', 'desc').limit(60).get();
  const nameOf = (uid) => Object.values(PEOPLE).find((p) => p.uid === uid)?.name ?? uid;
  return snap.docs.map((d) => {
    const n = d.data();
    return { to: nameOf(n.toUid), title: n.title, body: n.body, category: n.category, badge: n.badge, at: n.at?.toMillis?.() ?? null };
  });
}

async function balance(month) {
  const snap = await db.collection(`groups/${GROUP}/expenses`).where('competence', '==', month).get();
  const expenses = snap.docs.map((d) => d.data());
  const b = monthBalance(expenses, [R, Q]);
  const nameOf = (uid) => Object.values(PEOPLE).find((p) => p.uid === uid)?.name ?? uid;
  return { month, count: expenses.length, balance: b ? { from: nameOf(b.fromUid), to: nameOf(b.toUid), amountCents: b.amountCents } : null };
}

// ---- HTTP ----
function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'status') return send(res, 200, { ok: true, project: PROJECT, group: GROUP, months: months() });
    if (parts[0] === 'token' && PEOPLE[parts[1]]) {
      const p = PEOPLE[parts[1]];
      await auth.createUser({ uid: p.uid, displayName: p.name, email: `${p.uid}@exemplo.invalid` }).catch(() => undefined);
      return send(res, 200, { token: await auth.createCustomToken(p.uid, { name: p.name }), uid: p.uid, name: p.name });
    }
    if (parts[0] === 'scenario' && req.method === 'POST' && SCENARIOS[parts[1]]) {
      const started = Date.now();
      const result = await SCENARIOS[parts[1]]();
      return send(res, 200, { ok: true, scenario: parts[1], ms: Date.now() - started, result: result ?? null });
    }
    if (parts[0] === 'outbox') return send(res, 200, await outbox());
    if (parts[0] === 'balance') return send(res, 200, await balance(url.searchParams.get('month') ?? months().current));
    if (parts[0] === 'keys') return send(res, 200, testKeys());
    return send(res, 404, { error: 'rota desconhecida' });
  } catch (err) {
    console.error('[duo]', err);
    return send(res, 500, { error: String(err?.message ?? err) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[duo] Servidor de cenários em http://127.0.0.1:${PORT} (projeto ${PROJECT}, só emuladores)`));
