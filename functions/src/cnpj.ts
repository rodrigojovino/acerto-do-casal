/**
 * Nome do emitente pelo CNPJ (notas sem consulta à SEFAZ: NF-e, NFC-e de
 * outros estados, consulta que falhou). Funções puras + `fetchCnpjName`, a
 * única que acessa a rede (BrasilAPI). O CNPJ é público; nada do casal vai
 * junto na consulta.
 */

export const BRASIL_API_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1/';

/**
 * Cabeçalhos da consulta. O Cloudflare da BrasilAPI recusa (403) o User-Agent
 * padrão do `fetch` do Node: sem um User-Agent próprio, toda consulta voltava
 * "não encontrado" e a descrição ficava com o CNPJ.
 */
export const BRASIL_API_HEADERS = {
  'User-Agent': 'acerto-do-casal/1.0 (+https://github.com/rodrigojovino/acerto-do-casal)',
  Accept: 'application/json',
};

/** CNPJ numérico de 14 dígitos com os dois dígitos verificadores certos. */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (base: string) => {
    let sum = 0;
    let weight = base.length - 7;
    for (const ch of base) {
      sum += Number(ch) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(cnpj.slice(0, 12));
  const second = digit(cnpj.slice(0, 12) + first);
  return cnpj.endsWith(`${first}${second}`);
}

export interface CnpjName {
  /** Nome para a descrição: o fantasia ou, sem ele, a razão social. */
  name: string;
  fantasyName: string | null;
  legalName: string | null;
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : null);

/** Lê a resposta da BrasilAPI; `null` se não houver nenhum nome. */
export function parseCnpjResponse(json: unknown): CnpjName | null {
  const data = (json ?? {}) as { nome_fantasia?: unknown; razao_social?: unknown };
  const fantasyName = clean(data.nome_fantasia);
  const legalName = clean(data.razao_social);
  const name = fantasyName ?? legalName;
  return name ? { name, fantasyName, legalName } : null;
}

/**
 * Consulta a BrasilAPI. `null` quando o CNPJ não existe ou a consulta falha:
 * a descrição fica com o CNPJ formatado. `onFailure` recebe o motivo (status
 * HTTP ou erro) de uma consulta recusada, para o log; 404 é só não encontrado.
 */
export async function fetchCnpjName(
  cnpj: string,
  timeoutMs = 8000,
  onFailure?: (reason: string) => void,
): Promise<CnpjName | null> {
  try {
    const res = await fetch(BRASIL_API_CNPJ + cnpj, {
      redirect: 'error',
      headers: BRASIL_API_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (res.status !== 404) onFailure?.(`HTTP ${res.status}`);
      return null;
    }
    return parseCnpjResponse(await res.json());
  } catch (err) {
    onFailure?.(err instanceof Error ? err.message : String(err));
    return null;
  }
}
