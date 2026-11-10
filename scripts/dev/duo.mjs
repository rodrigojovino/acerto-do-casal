// Ambiente de dois aparelhos no PC: npm run dev:duo
// Sobe os emuladores (projeto demo-acerto, nunca a produção), o servidor de
// cenários e o app em modo duo, e abre a página com os dois aparelhos lado a lado.
// Ctrl+C encerra tudo.
import { spawn, spawnSync } from 'node:child_process';

const PROJECT = 'demo-acerto';
const env = {
  ...process.env,
  GCLOUD_PROJECT: PROJECT,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
};
// O app em modo duo: projeto de teste, emuladores e login automático (só em desenvolvimento).
const appEnv = {
  ...env,
  VITE_FIREBASE_PROJECT_ID: PROJECT,
  VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
  VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
  VITE_USE_EMULATORS: 'true',
  VITE_DEV_DUO: 'true',
};
const PAGE = 'http://localhost:5173/src/dev/duo.html';

const children = [];
function run(name, command, extraEnv = env) {
  const child = spawn(command, { shell: true, env: extraEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (line) => `[${name}] ${line}`;
  child.stdout.on('data', (b) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag(l))));
  child.stderr.on('data', (b) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.error(tag(l))));
  child.on('exit', (code) => console.log(tag(`encerrado (código ${code})`)));
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('exit', stopAll);

async function waitFor(url, label, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${label} não respondeu em ${ms / 1000} s (${url}).`);
}

console.log('[duo] Compilando as Functions…');
const build = spawnSync('npm run functions:build', { shell: true, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

run('emuladores', `npx firebase emulators:start --project ${PROJECT} --only auth,firestore,functions,storage`);
await waitFor('http://127.0.0.1:8080/', 'Emulador do Firestore');
await waitFor('http://127.0.0.1:9099/', 'Emulador do Auth');
await waitFor('http://127.0.0.1:5001/', 'Emulador das Functions');

run('cenarios', 'node scripts/dev/duo-server.mjs');
await waitFor('http://127.0.0.1:5180/status', 'Servidor de cenários');

run('app', 'npx vite --mode duo --host 127.0.0.1 --port 5173 --strictPort', appEnv);
await waitFor('http://127.0.0.1:5173/', 'App (Vite)');

console.log(`\n[duo] Pronto: ${PAGE}\n[duo] Ctrl+C encerra tudo.\n`);
if (!process.argv.includes('--sem-navegador')) {
  const opener = process.platform === 'win32' ? `start "" "${PAGE}"` : process.platform === 'darwin' ? `open "${PAGE}"` : `xdg-open "${PAGE}"`;
  spawn(opener, { shell: true, stdio: 'ignore', detached: true }).unref();
}
