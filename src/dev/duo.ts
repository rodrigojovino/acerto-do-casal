/**
 * Modo duo (npm run dev:duo), SÓ em desenvolvimento: este módulo é carregado
 * por `main.ts` atrás de `import.meta.env.DEV && VITE_DEV_DUO`, e o build de
 * produção não o inclui (conferido por scripts/ci/sem-emuladores.mjs).
 *
 * Cada aparelho da página duo é este app num iframe (origens diferentes:
 * localhost e 127.0.0.1, com login e cache offline independentes). Aqui:
 * - login automático como a pessoa do aparelho (?dev=rodrigo | queila), com o
 *   token do servidor de cenários (só emuladores);
 * - comandos da página: modo avião, recarregar, ir para uma rota;
 * - relatório do saldo como a tela do Painel mostra (para o painel de conferência).
 */
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import router from '@/router';
import { auth, db } from '@/services/firebase';

const MARK = 'acerto-dev-duo';
const SERVER = 'http://127.0.0.1:5180';
const PEOPLE: Record<string, string> = { rodrigo: 'dev-rodrigo', queila: 'dev-queila' };

const fromUrl = new URLSearchParams(location.search).get('dev');
if (fromUrl) sessionStorage.setItem(`${MARK}:who`, fromUrl);
const who = fromUrl ?? sessionStorage.getItem(`${MARK}:who`);
const expectedUid = who ? PEOPLE[who] : undefined;

function post(message: Record<string, unknown>): void {
  if (window.parent !== window) window.parent.postMessage({ source: MARK, who, ...message }, '*');
}

// ---- Login automático (só emuladores) ----
let loggingIn = false;
async function login(): Promise<void> {
  if (!who || !expectedUid || loggingIn) return;
  loggingIn = true;
  try {
    const res = await fetch(`${SERVER}/token/${who}`);
    const { token } = (await res.json()) as { token: string };
    if (auth.currentUser && auth.currentUser.uid !== expectedUid) await signOut(auth);
    await signInWithCustomToken(auth, token);
    if (router.currentRoute.value.name === 'entrar') await router.replace({ name: 'painel' });
  } catch (err) {
    console.warn('[duo] login automático falhou; tentando de novo em 3 s', err);
    setTimeout(() => void login(), 3000);
  } finally {
    loggingIn = false;
  }
}
onAuthStateChanged(auth, (u) => {
  if (!u || u.uid !== expectedUid) void login();
  post({ type: 'auth', uid: u?.uid ?? null });
});

// ---- Modo avião: Firestore sem rede, navigator.onLine falso, Functions e Storage recusados ----
let offline = false;
const backend = /(?:localhost|127\.0\.0\.1):(?:9099|8080|5001|9199)\b/;
const onLineGetter = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')?.get;
Object.defineProperty(navigator, 'onLine', {
  configurable: true,
  get: () => (offline ? false : (onLineGetter?.call(navigator) ?? true)),
});
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (offline && backend.test(url)) return Promise.reject(new TypeError('Sem conexão (modo avião do duo).'));
  return realFetch(input, init);
};
const realOpen = XMLHttpRequest.prototype.open;
const realSend = XMLHttpRequest.prototype.send;
const xhrUrl = new WeakMap<XMLHttpRequest, string>();
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  xhrUrl.set(this, String(url));
  return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  if (offline && backend.test(xhrUrl.get(this) ?? '')) {
    setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
    return;
  }
  return realSend.call(this, body);
};

async function setOffline(value: boolean): Promise<void> {
  offline = value;
  if (value) await disableNetwork(db);
  else await enableNetwork(db);
  window.dispatchEvent(new Event(value ? 'offline' : 'online'));
  post({ type: 'offline', value });
}

// ---- Saldo como a tela do Painel mostra ----
function visibleBalance(): { who: string; amount: string } | null {
  const card = document.querySelector('.ion-page:not(.ion-page-hidden) section.balance');
  if (!card) return null;
  const whoText = card.querySelector('.who')?.textContent?.trim() ?? '';
  const amount = card.querySelector('.amount')?.textContent?.trim() ?? '';
  return { who: whoText, amount };
}

// ---- Comandos da página duo ----
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { target?: string; type?: string; path?: string; value?: boolean } | null;
  if (!data || data.target !== MARK) return;
  if (data.type === 'offline') void setOffline(!!data.value);
  else if (data.type === 'reload') location.reload();
  else if (data.type === 'go' && data.path) void router.push(data.path);
  else if (data.type === 'report') {
    const route = router.currentRoute.value;
    post({ type: 'report', route: route.fullPath, routeName: route.name, month: route.query.mes ?? null, balance: visibleBalance() });
  }
});

router.afterEach((to) => post({ type: 'route', route: to.fullPath, routeName: to.name, params: to.params }));
post({ type: 'ready', offline });
