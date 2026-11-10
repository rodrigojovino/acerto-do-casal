// Confere que o build de produção (dist/) não leva nada dos emuladores nem do
// ambiente de dois aparelhos (npm run dev:duo): projeto de teste, endereços
// das portas dos emuladores e do servidor de cenários, e os marcadores do modo
// duo. Padrões específicos (nunca "127.0.0.1" solto, que aparece em textos do
// SDK). Uso: node scripts/ci/sem-emuladores.mjs [pasta]   (padrão: dist)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist';

const PATTERNS = [
  { name: 'projeto de teste dos emuladores', re: /demo-acerto/ },
  // Auth 9099, Firestore 8080, Functions 5001, Storage 9199, interface 4000, servidor de cenários 5180.
  { name: 'endereço de emulador', re: /(?:localhost|127\.0\.0\.1)["'`]?\s*[,:]\s*["'`]?(?:9099|8080|5001|9199|4000|5180)\b/ },
  { name: 'marcador do modo duo', re: /acerto-dev-duo|dev-rodrigo|dev-queila|VITE_DEV_DUO/ },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|html|css|json|map)$/.test(name)) yield path;
  }
}

let checked = 0;
const found = [];
for (const path of files(root)) {
  checked++;
  const text = readFileSync(path, 'utf8');
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) found.push(`${path}: ${name} ("${m[0]}")`);
  }
}

if (checked === 0) {
  console.error(`Nenhum arquivo em ${root}/: rode o build antes.`);
  process.exit(1);
}
if (found.length > 0) {
  for (const f of found) console.error(`::error::${f}`);
  console.error(`O build de produção tem referências aos emuladores ou ao modo duo (${found.length}).`);
  process.exit(1);
}
console.log(`Sem referências aos emuladores nem ao modo duo em ${checked} arquivos de ${root}/.`);
