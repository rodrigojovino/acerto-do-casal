/**
 * Confere a leitura dos itens (`parseItems`) com notas reais de SP, mostrando
 * SÓ contagens e sim/não: nenhum item, valor, loja ou chave aparece na saída.
 *
 * Uso (Node 24+, VPN desligada — com VPN a SEFAZ recusa a consulta):
 *   node --experimental-transform-types scripts/sefaz-poc/testar-itens.ts notas.local.txt
 *
 * O arquivo tem uma URL de QR por linha. Nunca versionar URLs reais: use um
 * arquivo *.local.txt (ignorado pelo git).
 */
import { readFileSync } from 'node:fs';
import { SEFAZ_SP_CANONICAL, parseItems, parseNfceQr, parsePage } from '../../functions/src/nfce.ts';

const file = process.argv[2];
if (!file) {
  console.error('Informe o arquivo com as URLs (ex.: notas.local.txt).');
  process.exit(1);
}

const lines = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const yesNo = (b: boolean) => (b ? 'sim' : 'não');
let n = 0;
let ok = 0;
for (const line of lines) {
  n++;
  let key: string;
  try {
    key = parseNfceQr(line).key;
  } catch {
    console.log(`nota ${n}: QR inválido`);
    continue;
  }
  let html: string;
  try {
    const res = await fetch(`${SEFAZ_SP_CANONICAL}${key}|3|1`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    html = await res.text();
  } catch {
    console.log(`nota ${n}: SEFAZ não respondeu`);
    continue;
  }
  const page = parsePage(html);
  if (page.error || page.totalCents === undefined) {
    console.log(`nota ${n}: a SEFAZ não devolveu a nota (VPN ligada?)`);
    continue;
  }
  const items = parseItems(html);
  if (!items) {
    console.log(`nota ${n}: itens NÃO lidos`);
    continue;
  }
  ok++;
  console.log(
    `nota ${n}: ${items.items.length} itens · soma bate: ${yesNo(items.consistent)} · ` +
      `total = o da conferência: ${yesNo(items.totalCents === page.totalCents)} · desconto: ${yesNo(items.discountCents > 0)} · ` +
      `meios de pagamento: ${items.payments.length} · troco: ${yesNo((items.changeCents ?? 0) > 0)} · ` +
      `qtd. fracionada: ${yesNo(items.items.some((i) => !Number.isInteger(i.quantity)))}`,
  );
}
console.log(`itens lidos em ${ok} de ${n} notas`);
