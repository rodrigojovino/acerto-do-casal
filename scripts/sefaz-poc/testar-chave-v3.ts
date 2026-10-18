/**
 * Confere se a consulta pública da SEFAZ-SP aceita a URL montada só da chave
 * (formato do QR versão 3: `chave|3|1`, sem hash) para as mesmas notas cujo QR
 * é versão 2 (com hash). Decide se código de barras e chave digitada de SP
 * podem ter conferência automática.
 *
 * Uso (Node 24+):
 *   node --experimental-transform-types scripts/sefaz-poc/testar-chave-v3.ts notas.local.txt
 *
 * O arquivo tem uma URL de QR por linha. Nunca versionar URLs reais: use um
 * arquivo *.local.txt (ignorado pelo git). A saída não mostra chave, emitente
 * nem valor, só se as duas consultas deram certo e se os dados batem.
 */
import { readFileSync } from 'node:fs';
import { SEFAZ_SP_CANONICAL, parseNfceQr, parsePage, toResult } from '../../functions/src/nfce.ts';

async function consult(url: string, qr: ReturnType<typeof parseNfceQr>) {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` };
    return { ok: true as const, result: toResult(qr, parsePage(html)) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

const file = process.argv[2];
if (!file) {
  console.error('Informe o arquivo com as URLs (ex.: notas.local.txt).');
  process.exit(1);
}

const lines = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

let n = 0;
for (const line of lines) {
  n++;
  let qr;
  try {
    qr = parseNfceQr(line);
  } catch (err) {
    console.log(`nota ${n}: QR inválido (${err instanceof Error ? err.message : err})`);
    continue;
  }
  if (qr.access.uf !== 'SP') {
    console.log(`nota ${n}: não é de SP, ignorada`);
    continue;
  }
  const p = new URL(line).searchParams.get('p') ?? '';
  const version = p.split('|')[1] ?? '?';
  const original = await consult(SEFAZ_SP_CANONICAL + p, qr);
  const fromKey = await consult(`${SEFAZ_SP_CANONICAL}${qr.key}|3|1`, qr);
  const same =
    original.ok && fromKey.ok
      ? original.result.totalCents === fromKey.result.totalCents &&
        original.result.date === fromKey.result.date &&
        original.result.issuerCnpj === fromKey.result.issuerCnpj
      : null;
  console.log(
    `nota ${n} (QR versão ${version}): QR original ${original.ok ? 'ok' : `falhou (${original.error})`} · ` +
      `chave|3|1 ${fromKey.ok ? 'ok' : `falhou (${fromKey.error})`}` +
      (same === null ? '' : ` · mesmos dados: ${same ? 'sim' : 'NÃO'}`),
  );
}
