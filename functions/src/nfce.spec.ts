import { describe, expect, it } from 'vitest';
import {
  NfceError,
  brlToCents,
  checkDigit,
  parseAccessKey,
  parsePage,
  parseQrUrl,
  toResult,
} from './nfce';

// Dados 100% fictícios: CNPJ inventado, nenhuma nota real.
const CNPJ = '11222333000181';
const BASE = `352610${CNPJ}65001000000123112345678`; // 43 dígitos
const KEY = BASE + checkDigit(BASE);
const HASH = 'A'.repeat(40);
const URL_OK = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${KEY}|2|1|1|${HASH}`;

function page(overrides: { total?: string; date?: string; cnpj?: string; issuer?: string; extra?: string } = {}): string {
  const { total = '1.234,56', date = '05/10/2026 11:56:22', cnpj = '11.222.333/0001-81', issuer = 'LOJA TESTE LTDA', extra = '' } = overrides;
  return `<html><body>
    <div id="u20" class="txtTopo">${issuer}</div>
    <div class="text">
      CNPJ:
      ${cnpj}</div>
    <div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label>
      <span class="totalNumb txtMax">${total}</span></div>
    <li><strong>Número: </strong>123<strong> Série: </strong>1<strong> Emissão: </strong>${date}
      - Via Consumidor</li>
    ${extra}
  </body></html>`;
}

describe('chave de acesso', () => {
  it('decodifica UF, mês, CNPJ e confere o dígito verificador', () => {
    const k = parseAccessKey(KEY);
    expect(k).toMatchObject({ uf: '35', yearMonth: '2026-10', cnpj: CNPJ, model: '65', series: 1, number: 123 });
    expect(k.checkDigitOk).toBe(true);
  });

  it('detecta dígito verificador errado', () => {
    const wrong = BASE + ((checkDigit(BASE) + 1) % 10);
    expect(parseAccessKey(wrong).checkDigitOk).toBe(false);
  });
});

describe('parseQrUrl', () => {
  it('aceita a URL da SEFAZ-SP', () => {
    expect(parseQrUrl(URL_OK)).toMatchObject({ key: KEY, version: '2', production: true });
  });

  it('recusa outros endereços (a Function nunca busca URL arbitrária)', () => {
    const cases = [
      'http://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/x?p=' + KEY,
      'https://evil.example.com/NFCeConsultaPublica/x?p=' + KEY,
      'https://www.nfce.fazenda.sp.gov.br.evil.com/NFCeConsultaPublica/x?p=' + KEY,
      'https://www.nfce.fazenda.sp.gov.br/outra/coisa?p=' + KEY,
      'https://169.254.169.254/latest/meta-data',
      'não é url',
    ];
    for (const c of cases) expect(() => parseQrUrl(c), c).toThrow(NfceError);
  });

  it('recusa chave inválida, de outra UF ou de outro modelo', () => {
    const otherUf = '33' + BASE.slice(2);
    const otherModel = BASE.slice(0, 20) + '55' + BASE.slice(22);
    for (const base of [otherUf, otherModel]) {
      const url = URL_OK.replace(KEY, base + checkDigit(base));
      expect(() => parseQrUrl(url)).toThrow(NfceError);
    }
    expect(() => parseQrUrl(URL_OK.replace(KEY, KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10)))).toThrow(NfceError);
  });

  it('lê dia e valor do QR de contingência offline', () => {
    const url = URL_OK.replace(`|2|1|1|${HASH}`, `|2|1|05|123.45|${'B'.repeat(56)}|1|${HASH}`);
    expect(parseQrUrl(url).offline).toEqual({ day: '05', totalCents: 12345 });
  });
});

describe('parsePage e toResult', () => {
  it('extrai os dados da nota e confere com a chave', () => {
    const qr = parseQrUrl(URL_OK);
    expect(toResult(qr, parsePage(page()))).toEqual({
      key: KEY,
      issuerName: 'LOJA TESTE LTDA',
      issuerCnpj: CNPJ,
      totalCents: 123456,
      date: '2026-10-05',
    });
  });

  it('entende entidades HTML no texto', () => {
    expect(parsePage(page({ issuer: 'CAF&#201; &amp; CIA' })).issuerName).toBe('CAFÉ & CIA');
  });

  it('erro da SEFAZ (hash inválido) não vira nota', () => {
    const html = `<script>$('#spnAlertaProsseguirMaster').html('<ul><li>Verifique. Erro(s): </br>- Hash QR Code inválido</li></ul>');</script>`;
    const data = parsePage(html);
    expect(data.error).toBe('Hash QR Code inválido');
    expect(() => toResult(parseQrUrl(URL_OK), data)).toThrow(/recusou/);
  });

  it('captcha é detectado como bloqueio', () => {
    const data = parsePage(page({ extra: '<div class="g-recaptcha"></div>' }));
    expect(() => toResult(parseQrUrl(URL_OK), data)).toThrow(/captcha/);
  });

  it('layout desconhecido não vira dado errado', () => {
    expect(() => toResult(parseQrUrl(URL_OK), parsePage('<html>nova página</html>'))).toThrow(/ler os dados/);
  });

  it('CNPJ ou mês diferentes da chave são recusados', () => {
    const qr = parseQrUrl(URL_OK);
    expect(() => toResult(qr, parsePage(page({ cnpj: '99.999.999/0001-99' })))).toThrow(/não batem/);
    expect(() => toResult(qr, parsePage(page({ date: '05/09/2026 10:00:00' })))).toThrow(/não batem/);
  });
});

describe('brlToCents', () => {
  it('converte sem float', () => {
    expect(brlToCents('55,48')).toBe(5548);
    expect(brlToCents('1.234,56')).toBe(123456);
    expect(brlToCents('0,05')).toBe(5);
    expect(() => brlToCents('55.48')).toThrow(NfceError);
  });
});
