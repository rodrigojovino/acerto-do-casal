// Chrome sem janela controlado pelo protocolo de depuração (sem dependências),
// para o ambiente de dois aparelhos: capturas de tela em larguras fixas e
// passos simples (clicar, esperar um texto). Só para desenvolvimento.
//
//   import { openBrowser } from './navegador.mjs';
//   const b = await openBrowser({ width: 1400, height: 1000 });
//   await b.goto('http://localhost:5173/src/dev/duo.html');
//   await b.waitFor(() => document.querySelector('#x')?.textContent?.includes('ok'));
//   await b.screenshot('saida.png');
//   await b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export async function openBrowser({ width = 390, height = 844, port = 9333, scale = 1 } = {}) {
  const { existsSync } = await import('node:fs');
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('Chrome/Edge não encontrado (defina CHROME_PATH).');
  const profile = mkdtempSync(join(tmpdir(), 'acerto-navegador-'));
  const proc = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  let pages = [];
  for (let i = 0; i < 50 && pages.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 200));
    pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    pages = pages.filter((p) => p.type === 'page');
  }
  if (pages.length === 0) throw new Error('O navegador não abriu a porta de depuração.');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 600 });

  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'erro no navegador');
    return r.result.value;
  };

  return {
    send,
    evaluate,
    async goto(url) {
      await send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 500));
    },
    async waitFor(fn, ms = 30_000, ...args) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await evaluate(fn, ...args).catch(() => false)) return true;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error(`Tempo esgotado esperando: ${fn.toString().slice(0, 120)}`);
    },
    async resize(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: w < 600 });
    },
    async screenshot(path, { fullPage = false } = {}) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    },
    async close() {
      ws.close();
      proc.kill();
      await new Promise((r) => setTimeout(r, 500));
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
