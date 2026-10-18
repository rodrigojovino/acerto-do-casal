/**
 * Documento fiscal (NFC-e modelo 65 ou NF-e modelo 55) a partir do QR Code, do
 * código de barras da chave ou da chave digitada: leitura da chave (qualquer
 * estado) e consulta pública na SEFAZ-SP (só NFC-e de SP tem conferência
 * automática; a consulta de NF-e exige captcha).
 * Parser vindo da prova de conceito (scripts/sefaz-poc), agora com testes.
 *
 * Funções puras + `fetchNfce`, a única que acessa a rede. O QR pode vir de
 * qualquer domínio de SEFAZ, mas a rede só é acessada na URL canônica da
 * SEFAZ-SP, montada aqui a partir da chave: a Function nunca busca o endereço
 * que veio no QR nem segue redirecionamentos.
 */

export const SEFAZ_SP_HOST = 'www.nfce.fazenda.sp.gov.br';
export const SEFAZ_SP_CANONICAL = `https://${SEFAZ_SP_HOST}/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=`;

/** Códigos IBGE das UFs (dois primeiros dígitos da chave de acesso). */
export const UF_BY_CODE: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export interface AccessKey {
  /** Código IBGE da UF, ex.: '35'. */
  ufCode: string;
  /** Sigla da UF, ex.: 'SP' (undefined se o código não existir). */
  uf: string | undefined;
  /** YYYY-MM */
  yearMonth: string;
  cnpj: string;
  model: string;
  series: number;
  number: number;
  emissionType: string;
  checkDigitOk: boolean;
}

export interface QrData {
  key: string;
  access: AccessKey;
  /** URL canônica de consulta na SEFAZ-SP; null para outros estados (sem consulta). */
  spUrl: string | null;
  /** QR de contingência offline (tpEmis 9) traz dia e valor no próprio QR. */
  offline?: { day: string; totalCents: number };
}

export interface PageData {
  issuerName?: string;
  issuerCnpj?: string;
  totalCents?: number;
  /** YYYY-MM-DD */
  date?: string;
  time?: string;
  /** Mensagem de erro da própria SEFAZ, ex.: "Hash QR Code inválido". */
  error?: string;
  blockers: string[];
}

export interface NfceResult {
  key: string;
  issuerName: string;
  issuerCnpj: string;
  totalCents: number;
  date: string;
}

export class NfceError extends Error {
  constructor(
    readonly reason: 'invalid_url' | 'not_sp' | 'invalid_key' | 'sefaz_error' | 'blocked' | 'unparsed' | 'mismatch' | 'network',
    message: string,
  ) {
    super(message);
  }
}

/** Dígito verificador da chave de acesso: módulo 11 com pesos 2..9. */
export function checkDigit(first43: string): number {
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
  if (!/^\d{44}$/.test(key)) throw new NfceError('invalid_key', 'Chave de acesso inválida.');
  return {
    ufCode: key.slice(0, 2),
    uf: UF_BY_CODE[key.slice(0, 2)],
    yearMonth: `20${key.slice(2, 4)}-${key.slice(4, 6)}`,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: Number(key.slice(22, 25)),
    number: Number(key.slice(25, 34)),
    emissionType: key.slice(34, 35),
    checkDigitOk: checkDigit(key.slice(0, 43)) === Number(key[43]),
  };
}

/** Converte "1.234,56" em 123456 centavos, sem passar por float. */
export function brlToCents(text: string): number {
  const m = text.trim().match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!m) throw new NfceError('unparsed', `Valor em formato inesperado: "${text}".`);
  return Number(m[1].replace(/\./g, '') + m[2]);
}

/** Modelos aceitos como comprovante: NF-e (55) e NFC-e (65). */
export type FiscalModel = '55' | '65';

/** Valida a chave de NF-e ou NFC-e: UF existente, modelo 55 ou 65 e dígito verificador. */
export function validateFiscalKey(key: string): AccessKey & { model: FiscalModel } {
  const access = parseAccessKey(key);
  if (!access.uf) throw new NfceError('invalid_key', 'A chave desta nota não é válida (UF desconhecida).');
  if (access.model !== '55' && access.model !== '65') {
    throw new NfceError('invalid_key', `Esta chave não é de NF-e nem de NFC-e (modelo ${access.model}).`);
  }
  if (!access.checkDigitOk) throw new NfceError('invalid_key', 'A chave desta nota não é válida (dígito verificador).');
  return access as AccessKey & { model: FiscalModel };
}

/** Valida a chave de uma NFC-e (modelo 65): a única com consulta pública sem captcha. */
export function validateKey(key: string): AccessKey {
  const access = validateFiscalKey(key);
  if (access.model !== '65') throw new NfceError('invalid_key', 'Esta chave não é de uma NFC-e (cupom fiscal).');
  return access;
}

/**
 * URL de consulta na SEFAZ-SP montada só da chave, no formato do QR versão 3
 * (`chave|3|1`: ambiente de produção, sem hash). Só NFC-e de SP; `null` nas
 * demais. QR, código de barras e chave digitada da mesma nota dão a mesma URL.
 */
export function spConsultUrl(key: string): string | null {
  return /^35\d{18}65\d{22}$/.test(key) ? `${SEFAZ_SP_CANONICAL}${key}|3|1` : null;
}

/** Chave de NF-e ou NFC-e lida (QR ou código de barras) ou digitada. */
export interface FiscalCode {
  key: string;
  access: AccessKey & { model: FiscalModel };
  spUrl: string | null;
}

/**
 * Lê o conteúdo do leitor: código de barras (Code 128 com os 44 dígitos da
 * chave, NF-e ou NFC-e) ou QR Code de NFC-e (ver `parseNfceQr`).
 */
export function parseFiscalCode(raw: string): FiscalCode {
  const text = raw.trim();
  if (/^\d{44}$/.test(text)) {
    return { key: text, access: validateFiscalKey(text), spUrl: spConsultUrl(text) };
  }
  const qr = parseNfceQr(text);
  return { key: qr.key, access: qr.access as AccessKey & { model: FiscalModel }, spUrl: qr.spUrl };
}

/**
 * Chave digitada (como vem impressa, em blocos de 4 com espaços): só dígitos,
 * 44 deles, modelo 55 ou 65 e dígito verificador.
 */
export function parseTypedKey(input: string): FiscalCode {
  const digits = input.replace(/[\s.-]/g, '');
  if (!/^\d*$/.test(digits)) throw new NfceError('invalid_key', 'Digite só os números da chave.');
  if (digits.length !== 44) {
    throw new NfceError('invalid_key', `A chave tem 44 dígitos (foram digitados ${digits.length}).`);
  }
  return { key: digits, access: validateFiscalKey(digits), spUrl: spConsultUrl(digits) };
}

/**
 * Lê o QR de NFC-e de qualquer estado e domínio de SEFAZ:
 * - `p=chave|versão|...` (versões 2 e 3; aceita http/https, com ou sem www,
 *   /qrcode ou ConsultaQRCode.aspx);
 * - `chNFe=chave` (versão 1);
 * - em último caso, uma sequência de 44 dígitos no texto.
 * Para SP, monta a URL de consulta a partir da chave (`spConsultUrl`). Nunca usa o endereço lido.
 *
 * Versão 2 do `p`: online = chave|versão|ambiente|idCSC|hash (5 partes);
 * offline = chave|versão|ambiente|dia|vNF|digVal|idCSC|hash (8 partes).
 */
export function parseNfceQr(raw: string): QrData {
  const text = raw.trim();
  let p: string | null = null;
  let key: string | undefined;

  try {
    const url = new URL(text);
    p = url.searchParams.get('p');
    key = p?.split('|')[0] ?? url.searchParams.get('chNFe') ?? undefined;
  } catch {
    // Não é URL: procura a chave no texto.
  }
  key ??= text.match(/(?<!\d)\d{44}(?!\d)/)?.[0];
  if (!key || !/^\d{44}$/.test(key)) {
    throw new NfceError('invalid_url', 'Este QR Code não é de uma nota fiscal.');
  }

  const access = validateKey(key);
  const parts = p?.split('|') ?? [];

  const data: QrData = { key, access, spUrl: spConsultUrl(key) };
  if (parts[1] === '2' && parts.length === 8 && /^\d+(\.\d{1,2})?$/.test(parts[4])) {
    const [reais, cents = ''] = parts[4].split('.');
    data.offline = { day: parts[3], totalCents: Number(reais) * 100 + Number(cents.padEnd(2, '0')) };
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
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai emitente, CNPJ, valor a pagar e data/hora da página de consulta. */
export function parsePage(html: string): PageData {
  const blockers: string[] = [];
  if (/g-recaptcha|hcaptcha|cf-turnstile|captcha/i.test(html)) blockers.push('captcha');

  const issuer = html.match(/id="u20"[^>]*>([^<]+)</);
  const cnpj = html.match(/CNPJ:\s*([\d./-]+)/);
  const total = html.match(/class="totalNumb txtMax"[^>]*>([^<]+)</);
  const emission = html.match(
    /Emiss(?:ão|&#227;o|&atilde;o|ao):\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/,
  );
  const error = html.match(/Erro\(s\):\s*<\/br>\s*-\s*([^<]+)</);

  const data: PageData = { blockers };
  if (issuer) data.issuerName = decodeEntities(issuer[1]);
  if (cnpj) data.issuerCnpj = cnpj[1].replace(/\D/g, '');
  if (total) data.totalCents = brlToCents(decodeEntities(total[1]));
  if (emission) {
    const [, d, m, y, time] = emission;
    data.date = `${y}-${m}-${d}`;
    data.time = time;
  }
  if (error) data.error = decodeEntities(error[1]);
  return data;
}

/**
 * Confere a página com a chave do QR (CNPJ e mês). Uma mudança de layout da
 * SEFAZ cai aqui em vez de virar dado errado.
 */
export function toResult(qr: QrData, page: PageData): NfceResult {
  if (page.error) throw new NfceError('sefaz_error', `A SEFAZ recusou a nota: ${page.error}.`);
  if (page.blockers.length) throw new NfceError('blocked', 'A consulta da SEFAZ pediu verificação (captcha).');
  if (!page.issuerName || page.totalCents === undefined || !page.date || !page.issuerCnpj) {
    throw new NfceError('unparsed', 'Não foi possível ler os dados da nota.');
  }
  if (page.issuerCnpj !== qr.access.cnpj || page.date.slice(0, 7) !== qr.access.yearMonth) {
    throw new NfceError('mismatch', 'Os dados da página não batem com a chave da nota.');
  }
  return {
    key: qr.key,
    issuerName: page.issuerName,
    issuerCnpj: page.issuerCnpj,
    totalCents: page.totalCents,
    date: page.date,
  };
}

export interface FetchTiming {
  status: number;
  ms: number;
}

/**
 * Busca e interpreta uma nota de SP. Única função com acesso à rede, e só na
 * URL canônica da SEFAZ-SP (montada por `parseNfceQr`), sem redirecionamentos.
 */
export async function fetchNfce(qrContent: string, timeoutMs = 15_000): Promise<{ result: NfceResult; timing: FetchTiming }> {
  const qr = parseNfceQr(qrContent);
  if (!qr.spUrl) throw new NfceError('not_sp', 'A conferência automática é só para notas de SP.');
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(qr.spUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
  } catch {
    throw new NfceError('network', 'A SEFAZ não respondeu. Tente de novo mais tarde.');
  }
  const html = await res.text();
  const timing = { status: res.status, ms: Date.now() - started };
  if (!res.ok) throw new NfceError('network', `A SEFAZ respondeu com erro (${res.status}).`);
  return { result: toResult(qr, parsePage(html)), timing };
}
