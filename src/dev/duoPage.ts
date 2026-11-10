/**
 * Página do ambiente de dois aparelhos (npm run dev:duo), só em desenvolvimento:
 * dois iframes do app (Rodrigo em localhost, Queila em 127.0.0.1), controles por
 * aparelho, cenários, notas de teste, conferência do saldo e caixa de avisos.
 * Fala com o servidor de cenários (só emuladores) e com os aparelhos por postMessage.
 */
export {};

const MARK = 'acerto-dev-duo';
const SERVER = 'http://127.0.0.1:5180';
type Who = 'rodrigo' | 'queila';
const NAMES: Record<Who, string> = { rodrigo: 'Rodrigo', queila: 'Queila' };
const OTHER: Record<Who, Who> = { rodrigo: 'queila', queila: 'rodrigo' };
const ORIGIN: Record<Who, string> = { rodrigo: 'http://localhost:5173', queila: 'http://127.0.0.1:5173' };

interface DeviceReport {
  route: string;
  routeName: string | null;
  balance: { who: string; amount: string } | null;
}

const devices = Object.fromEntries(
  (['rodrigo', 'queila'] as Who[]).map((who) => {
    const root = document.querySelector<HTMLElement>(`.device[data-who="${who}"]`)!;
    return [who, { root, frame: root.querySelector<HTMLIFrameElement>('[data-frame]')!, route: '', offline: false }];
  }),
) as Record<Who, { root: HTMLElement; frame: HTMLIFrameElement; route: string; offline: boolean }>;

function send(who: Who, message: Record<string, unknown>): void {
  devices[who].frame.contentWindow?.postMessage({ target: MARK, ...message }, '*');
}

function load(who: Who, path = '/'): void {
  const sep = path.includes('?') ? '&' : '?';
  devices[who].frame.src = `${ORIGIN[who]}${path}${sep}dev=${who}`;
}

// ---- Mensagens dos aparelhos ----
const waiting = new Map<Who, (r: DeviceReport) => void>();
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { source?: string; who?: Who; type?: string } & Partial<DeviceReport> & { value?: boolean };
  if (!data || data.source !== MARK || !data.who || !devices[data.who]) return;
  const d = devices[data.who];
  if (data.type === 'route' && data.route) {
    d.route = data.route;
    d.root.querySelector('[data-route]')!.textContent = data.route;
  } else if (data.type === 'offline') {
    d.offline = !!data.value;
    const btn = d.root.querySelector<HTMLButtonElement>('[data-action="offline"]')!;
    btn.classList.toggle('on', d.offline);
    btn.textContent = d.offline ? 'Modo avião (ligado)' : 'Modo avião';
  } else if (data.type === 'report') {
    waiting.get(data.who)?.({ route: data.route ?? '', routeName: data.routeName ?? null, balance: data.balance ?? null });
    waiting.delete(data.who);
  }
});

// ---- Controles por aparelho ----
for (const who of ['rodrigo', 'queila'] as Who[]) {
  const d = devices[who];
  d.root.querySelector('[data-action="offline"]')!.addEventListener('click', () => send(who, { type: 'offline', value: !d.offline }));
  d.root.querySelector('[data-action="reload"]')!.addEventListener('click', () => send(who, { type: 'reload' }));
  d.root.querySelector('[data-action="mirror"]')!.addEventListener('click', () => {
    if (d.route) send(OTHER[who], { type: 'go', path: d.route });
  });
  load(who);
}

// ---- Cenários ----
const status = document.getElementById('scenario-status')!;
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))) {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.scenario!;
    document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => (b.disabled = true));
    status.textContent = `Preparando "${btn.textContent}"…`;
    try {
      const res = await fetch(`${SERVER}/scenario/${name}`, { method: 'POST' });
      const body = (await res.json()) as { ok?: boolean; ms?: number; error?: string; result?: unknown };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      status.textContent = `"${btn.textContent}" pronto em ${Math.round((body.ms ?? 0) / 100) / 10} s${body.result ? ` · ${JSON.stringify(body.result)}` : ''}.`;
      // Aparelhos recarregam do Painel (o cache local se ajusta aos dados novos).
      if (name !== 'recorrentes-dia1') (['rodrigo', 'queila'] as Who[]).forEach((w) => load(w));
    } catch (err) {
      status.textContent = `Falhou: ${String(err)}`;
    } finally {
      document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => (b.disabled = false));
    }
  });
}

// ---- Notas de teste ----
const KEY_LABELS: Record<string, string> = {
  itens: 'NFC-e de SP com 8 itens (com desconto)',
  barrada: 'NFC-e de SP barrada pelo filtro da SEFAZ',
  nfe: 'NF-e (sem consulta)',
  mg: 'NFC-e de MG (sem consulta)',
};
void fetch(`${SERVER}/keys`)
  .then((r) => r.json() as Promise<Record<string, string>>)
  .then((keys) => {
    const table = document.getElementById('keys') as HTMLTableElement;
    for (const [id, label] of Object.entries(KEY_LABELS)) {
      const row = table.insertRow();
      row.insertCell().textContent = label;
      const cell = row.insertCell();
      cell.innerHTML = `<code>${keys[id].replace(/(\d{4})(?=\d)/g, '$1 ')}</code> `;
      const copy = document.createElement('button');
      copy.textContent = 'Copiar';
      copy.addEventListener('click', () => void navigator.clipboard.writeText(keys[id]));
      cell.append(copy);
    }
  })
  .catch(() => (document.getElementById('keys')!.textContent = 'Servidor de cenários fora do ar.'));

// ---- Conferência do saldo ----
const monthInput = document.getElementById('check-month') as HTMLInputElement;
void fetch(`${SERVER}/status`)
  .then((r) => r.json() as Promise<{ months: { current: string } }>)
  .then((s) => (monthInput.value = s.months.current))
  .catch(() => undefined);

function report(who: Who): Promise<DeviceReport | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    waiting.set(who, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    send(who, { type: 'report' });
  });
}

interface Direction {
  from: string;
  to: string;
  amountCents: number;
}
/** Lê o que a tela mostra ("Queila te deve" / "Você deve para Queila" / "Ninguém deve nada", "R$ 1.234,56"). */
function parse(viewer: Who, b: DeviceReport['balance']): Direction | null | 'unreadable' {
  if (!b) return 'unreadable';
  const amountCents = Number(b.amount.replace(/\D/g, '') || '0');
  if (/Ninguém deve/.test(b.who) || amountCents === 0) return null;
  if (/te deve/.test(b.who)) return { from: NAMES[OTHER[viewer]], to: NAMES[viewer], amountCents };
  if (/Você deve/.test(b.who)) return { from: NAMES[viewer], to: NAMES[OTHER[viewer]], amountCents };
  return 'unreadable';
}
const describe = (d: Direction | null | 'unreadable') =>
  d === 'unreadable' ? 'não lido (o aparelho não está no Painel)' : d ? `${d.from} → ${d.to}: R$ ${(d.amountCents / 100).toFixed(2).replace('.', ',')}` : 'ninguém deve nada';
const same = (a: Direction | null | 'unreadable', b: Direction | null | 'unreadable') =>
  a !== 'unreadable' && b !== 'unreadable' && JSON.stringify(a) === JSON.stringify(b);

async function check(): Promise<void> {
  const month = monthInput.value;
  const result = document.getElementById('check-result')!;
  result.className = 'check';
  result.textContent = `Conferindo ${month}…`;
  (['rodrigo', 'queila'] as Who[]).forEach((w) => send(w, { type: 'go', path: `/painel?mes=${month}` }));
  await new Promise((r) => setTimeout(r, 2500));
  const [r, q, server] = await Promise.all([
    report('rodrigo'),
    report('queila'),
    fetch(`${SERVER}/balance?month=${month}`).then((x) => x.json() as Promise<{ count: number; balance: Direction | null }>),
  ]);
  const seenR = parse('rodrigo', r?.balance ?? null);
  const seenQ = parse('queila', q?.balance ?? null);
  const srv = server.balance ? { from: server.balance.from, to: server.balance.to, amountCents: server.balance.amountCents } : null;
  const table = document.getElementById('check-table') as HTMLTableElement;
  table.innerHTML = '';
  const row = (a: string, b: string, c: string) => {
    const tr = table.insertRow();
    [a, b, c].forEach((t) => (tr.insertCell().textContent = t));
  };
  row('Rodrigo vê', `"${r?.balance?.who ?? '—'}" ${r?.balance?.amount ?? ''}`, describe(seenR));
  row('Queila vê', `"${q?.balance?.who ?? '—'}" ${q?.balance?.amount ?? ''}`, describe(seenQ));
  row('Servidor (mesma função do app)', `${server.count} gastos no mês`, describe(srv));
  const ok = same(seenR, seenQ) && same(seenR, srv);
  result.className = `check ${ok ? 'ok' : 'bad'}`;
  result.textContent = ok
    ? `✔ Fecha: o que um deve é o que o outro tem a receber, e bate com o servidor (${month}).`
    : `✘ Não fecha em ${month}: veja a tabela.`;
}
document.getElementById('check-run')!.addEventListener('click', () => void check());

// ---- Caixa de avisos ----
async function refreshOutbox(): Promise<void> {
  try {
    const list = (await (await fetch(`${SERVER}/outbox`)).json()) as Array<{ to: string; title: string; body: string; badge?: number; at: number | null }>;
    const box = document.getElementById('outbox')!;
    box.innerHTML = '';
    if (list.length === 0) box.textContent = 'Nenhum aviso.';
    for (const n of list) {
      const div = document.createElement('div');
      div.className = 'notice';
      const when = n.at ? new Date(n.at).toLocaleTimeString('pt-BR') : '';
      div.innerHTML = `<div><span class="to"></span> <span class="when"></span></div><div class="title"></div><div class="body"></div>`;
      div.querySelector('.to')!.textContent = `Para ${n.to}${n.badge ? ` (ícone: ${n.badge})` : ''}`;
      div.querySelector('.when')!.textContent = when;
      div.querySelector('.title')!.textContent = n.title;
      div.querySelector('.body')!.textContent = n.body;
      box.append(div);
    }
  } catch {
    // servidor fora do ar: tenta de novo no próximo ciclo
  }
}
void refreshOutbox();
setInterval(() => void refreshOutbox(), 2000);
