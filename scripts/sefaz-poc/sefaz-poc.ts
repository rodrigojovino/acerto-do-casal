/**
 * Prova de conceito: a partir da URL do QR Code de uma NFC-e de SP, obter
 * valor total, data de emissão e emitente.
 *
 * Uso (Node 24+, que executa TypeScript nativamente):
 *   node scripts/sefaz-poc/sefaz-poc.ts "<url do QR>" ["<url>" ...]
 *   node scripts/sefaz-poc/sefaz-poc.ts --file urls.local.txt
 *
 * Nunca versionar URLs reais: use um arquivo *.local.txt (ignorado pelo git).
 *
 * Etapas:
 *   1. Offline: decodifica o parâmetro `p` do QR e a chave de acesso (44 dígitos).
 *   2. Online: consulta a página pública da SEFAZ-SP e extrai os campos do HTML.
 */
import { readFileSync } from 'node:fs';

interface AccessKey {
  uf: string;
  yearMonth: string; // YYYY-MM
  cnpj: string;
  model: string;
  series: string;
  number: string;
  emissionType: string;
  checkDigitOk: boolean;
}

interface QrData {
  key: string;
  version: string;
  environment: 'produção' | 'homologação' | string;
  /** QR de emissão em contingência offline (tpEmis 9) traz dia e valor no próprio QR. */
  offline?: { day: string; totalCents: number };
}

interface PageData {
  issuerName?: string;
  issuerCnpj?: string;
  totalCents?: number;
  /** YYYY-MM-DD */
  date?: string;
  time?: string;
  error?: string;
  blockers: string[];
}

const UF_CODES: Record<string, string> = { '35': 'SP' };

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Dígito verificador da chave de acesso: módulo 11 com pesos 2..9. */
function checkDigit(first43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function parseAccessKey(key: string): AccessKey {
  if (!/^\d{44}$/.test(key)) throw new Error(`chave de acesso inválida: ${key}`);
  return {
    uf: UF_CODES[key.slice(0, 2)] ?? key.slice(0, 2),
    yearMonth: `20${key.slice(2, 4)}-${key.slice(4, 6)}`,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
    emissionType: key.slice(34, 35),
    checkDigitOk: checkDigit(key.slice(0, 43)) === Number(key[43]),
  };
}

/** Converte "1.234,56" em 123456 centavos, sem passar por float. */
export function brlToCents(text: string): number {
  const m = text.trim().match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!m) throw new Error(`valor em formato inesperado: "${text}"`);
  return Number(m[1].replace(/\./g, '') + m[2]);
}

export function parseQrUrl(url: string): QrData {
  const p = new URL(url).searchParams.get('p');
  if (!p) throw new Error('URL sem o parâmetro "p"');
  const parts = p.split('|');
  const [key, version, env] = parts;
  const data: QrData = {
    key,
    version,
    environment: env === '1' ? 'produção' : env === '2' ? 'homologação' : env,
  };
  // Versão 2: online = chave|versão|ambiente|idCSC|hash (5 partes);
  // offline = chave|versão|ambiente|dia|vNF|digVal|idCSC|hash (8 partes).
  if (version === '2' && parts.length === 8) {
    data.offline = { day: parts[3], totalCents: Math.round(Number(parts[4]) * 100) };
  }
  return data;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePage(html: string): PageData {
  const blockers: string[] = [];
  if (/g-recaptcha|hcaptcha|cf-turnstile|captcha/i.test(html)) blockers.push('captcha');

  const issuer = html.match(/id="u20"[^>]*>([^<]+)</);
  const cnpj = html.match(/CNPJ:\s*([\d./-]+)/);
  const total = html.match(/class="totalNumb txtMax"[^>]*>([^<]+)</);
  const emission = html.match(/Emiss[ãa]o:\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  const error = html.match(/Erro\(s\):\s*<\/br>\s*-\s*([^<]+)</);

  const data: PageData = { blockers };
  if (issuer) data.issuerName = decodeEntities(issuer[1]);
  if (cnpj) data.issuerCnpj = onlyDigits(cnpj[1]);
  if (total) data.totalCents = brlToCents(decodeEntities(total[1]));
  if (emission) {
    const [, d, m, y, time] = emission;
    data.date = `${y}-${m}-${d}`;
    data.time = time;
  }
  if (error) data.error = decodeEntities(error[1]);
  return data;
}

async function fetchPage(url: string): Promise<{ status: number; ms: number; html: string }> {
  const started = Date.now();
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
  return { status: res.status, ms: Date.now() - started, html: await res.text() };
}

function formatCents(cents: number | undefined): string {
  if (cents === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

async function check(url: string, index: number): Promise<boolean> {
  console.log(`\n=== Nota ${index} ===`);

  const qr = parseQrUrl(url);
  const key = parseAccessKey(qr.key);
  console.log('[offline] chave:', {
    uf: key.uf,
    competênciaDaChave: key.yearMonth,
    cnpj: key.cnpj,
    modelo: key.model,
    série: Number(key.series),
    número: Number(key.number),
    tpEmis: key.emissionType,
    dvOk: key.checkDigitOk,
    versãoQr: qr.version,
    ambiente: qr.environment,
  });
  if (qr.offline) {
    console.log('[offline] QR de contingência traz:', {
      dia: qr.offline.day,
      valor: formatCents(qr.offline.totalCents),
    });
  } else {
    console.log('[offline] QR online: valor e data NÃO vêm no QR, só na consulta.');
  }

  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(url);
  } catch (err) {
    console.log('[online] falha de rede:', (err as Error).message);
    return false;
  }
  const data = parsePage(page.html);
  console.log(`[online] HTTP ${page.status} em ${page.ms} ms`);
  console.log('[online] extraído:', {
    emitente: data.issuerName ?? '—',
    cnpj: data.issuerCnpj ?? '—',
    valorTotal: formatCents(data.totalCents),
    totalCents: data.totalCents,
    data: data.date ?? '—',
    hora: data.time ?? '—',
  });
  if (data.error) console.log('[online] SEFAZ retornou erro:', data.error);
  if (data.blockers.length) console.log('[online] bloqueios:', data.blockers.join(', '));

  // Conferência cruzada com a chave de acesso
  const checks = {
    cnpjConfereComChave: data.issuerCnpj === key.cnpj,
    mêsConfereComChave: data.date?.slice(0, 7) === key.yearMonth,
  };
  console.log('[conferência]', checks);

  const ok =
    data.issuerName !== undefined &&
    data.totalCents !== undefined &&
    data.date !== undefined &&
    checks.cnpjConfereComChave &&
    checks.mêsConfereComChave;
  console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALHOU');
  return ok;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urls =
    args[0] === '--file'
      ? readFileSync(args[1], 'utf-8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      : args;
  if (urls.length === 0) {
    console.error('Uso: node scripts/sefaz-poc/sefaz-poc.ts "<url do QR>" ... | --file urls.local.txt');
    process.exit(2);
  }

  let okCount = 0;
  for (const [i, url] of urls.entries()) {
    if (await check(url, i + 1)) okCount++;
  }
  console.log(`\n${okCount}/${urls.length} notas lidas com sucesso.`);
  process.exit(okCount === urls.length ? 0 : 1);
}

main();
