import { describe, expect, it } from 'vitest';
import {
  NfceError,
  SEFAZ_SP_CANONICAL,
  brlToCents,
  checkDigit,
  checkItems,
  parseAccessKey,
  parseFiscalCode,
  parseItems,
  parseNfceQr,
  parsePage,
  parseTypedKey,
  spConsultUrl,
  toResult,
} from './nfce';

// Dados 100% fictícios: CNPJ inventado, nenhuma nota real.
const CNPJ = '11222333000181';
const withDv = (base43: string) => base43 + checkDigit(base43);
const keyFor = (ufCode: string, model = '65') => withDv(`${ufCode}2610${CNPJ}${model}001000000123112345678`);
const KEY = keyFor('35'); // SP
const KEY_MG = keyFor('31'); // MG
const HASH = 'A'.repeat(40);
const P = `${KEY}|2|1|1|${HASH}`;
const CANONICAL = SEFAZ_SP_CANONICAL + P;
/** URL de consulta montada só da chave (formato do QR versão 3). */
const FROM_KEY = `${SEFAZ_SP_CANONICAL}${KEY}|3|1`;

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
    expect(k).toMatchObject({ ufCode: '35', uf: 'SP', yearMonth: '2026-10', cnpj: CNPJ, model: '65', series: 1, number: 123 });
    expect(k.checkDigitOk).toBe(true);
    expect(parseAccessKey(KEY_MG).uf).toBe('MG');
  });

  it('detecta dígito verificador errado', () => {
    const wrong = KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10);
    expect(parseAccessKey(wrong).checkDigitOk).toBe(false);
  });
});

describe('parseNfceQr: São Paulo', () => {
  it('aceita as variações da URL de SP e sempre monta a URL canônica', () => {
    const variants = [
      `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${P}`,
      `http://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${P}`,
      `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${P}`,
      `http://www.nfce.fazenda.sp.gov.br/qrcode?p=${P}`,
      `https://nfce.fazenda.sp.gov.br/qrcode?p=${P}`,
      `http://nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${P}`,
      `  https://www.nfce.fazenda.sp.gov.br/qrcode?p=${encodeURIComponent(P)}  `,
    ];
    for (const v of variants) {
      const qr = parseNfceQr(v);
      expect(qr.key, v).toBe(KEY);
      expect(qr.spUrl, v).toBe(FROM_KEY);
    }
  });

  it('nunca usa o endereço lido: domínio estranho com chave de SP vira a URL canônica', () => {
    expect(parseNfceQr(`https://evil.example.com/qrcode?p=${P}`).spUrl).toBe(FROM_KEY);
    expect(parseNfceQr(`http://169.254.169.254/qrcode?p=${P}`).spUrl).toBe(FROM_KEY);
  });

  it('QR versão 3 (sem hash)', () => {
    const qr = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|3|1`);
    expect(qr.spUrl).toBe(`${SEFAZ_SP_CANONICAL}${KEY}|3|1`);
  });

  it('p com caracteres inesperados não vai para a URL: ela é montada só da chave', () => {
    const qr = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|<script>`);
    expect(qr.key).toBe(KEY);
    expect(qr.spUrl).toBe(FROM_KEY);
  });

  it('lê dia e valor do QR de contingência offline', () => {
    const url = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|05|123.45|${'B'.repeat(56)}|1|${HASH}`;
    expect(parseNfceQr(url).offline).toEqual({ day: '05', totalCents: 12345 });
  });
});

describe('parseNfceQr: outros estados', () => {
  it('QR de outra UF vale: chave validada, sem URL de consulta', () => {
    const qr = parseNfceQr(`https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=${KEY_MG}|2|1|1|${HASH}`);
    expect(qr.key).toBe(KEY_MG);
    expect(qr.access.uf).toBe('MG');
    expect(qr.access.cnpj).toBe(CNPJ);
    expect(qr.access.yearMonth).toBe('2026-10');
    expect(qr.spUrl).toBeNull();
  });

  it('QR versão 1 (chNFe) e chave solta no texto', () => {
    expect(parseNfceQr(`http://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?chNFe=${keyFor('43')}&nVersao=100`).access.uf).toBe('RS');
    expect(parseNfceQr(`Chave: ${keyFor('41')}`).access.uf).toBe('PR');
  });

  it('chave de SP sem p (versão 1) também tem consulta, pela URL montada da chave', () => {
    expect(parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?chNFe=${KEY}`).spUrl).toBe(FROM_KEY);
  });
});

describe('código de barras e chave digitada', () => {
  const NFE_SP = keyFor('35', '55');
  const spaced = (key: string) => key.replace(/(\d{4})(?=\d)/g, '$1 ');

  it('código de barras e QR da mesma NFC-e dão a mesma chave e a mesma URL de consulta', () => {
    const fromQr = parseFiscalCode(CANONICAL);
    const fromBarcode = parseFiscalCode(KEY);
    expect(fromBarcode).toEqual(fromQr);
    expect(fromBarcode.spUrl).toBe(FROM_KEY);
  });

  it('NF-e (modelo 55) vale, por código de barras ou digitada, sem consulta', () => {
    const scanned = parseFiscalCode(NFE_SP);
    expect(scanned.access.model).toBe('55');
    expect(scanned.spUrl).toBeNull();
    expect(spConsultUrl(NFE_SP)).toBeNull();
    expect(parseTypedKey(spaced(NFE_SP)).key).toBe(NFE_SP);
  });

  it('chave digitada aceita os espaços entre os blocos e, de SP, segue para a consulta', () => {
    const typed = parseTypedKey(` ${spaced(KEY)} `);
    expect(typed.key).toBe(KEY);
    expect(typed.spUrl).toBe(FROM_KEY);
    expect(parseTypedKey(spaced(KEY_MG)).spUrl).toBeNull();
  });

  it('chave digitada com dígito verificador inválido, tamanho errado, letras ou outro modelo é recusada', () => {
    const badDv = KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10);
    expect(() => parseTypedKey(badDv)).toThrow(/dígito verificador/);
    expect(() => parseTypedKey(KEY.slice(0, 40))).toThrow(/44 dígitos \(foram digitados 40\)/);
    expect(() => parseTypedKey(`${KEY.slice(0, 43)}X`)).toThrow(/só os números/);
    expect(() => parseTypedKey(keyFor('35', '57'))).toThrow(/modelo 57/);
    expect(() => parseFiscalCode(keyFor('35', '57'))).toThrow(/modelo 57/);
  });
});

describe('parseNfceQr: chaves inválidas', () => {
  const badDv = (key: string) => key.slice(0, 43) + ((Number(key[43]) + 1) % 10);

  it('dígito verificador inválido é recusado, em SP e fora', () => {
    expect(() => parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${badDv(KEY)}|2|1|1|${HASH}`)).toThrow(/dígito verificador/);
    expect(() => parseNfceQr(`https://qualquer.sefaz/qr?p=${badDv(KEY_MG)}|2|1`)).toThrow(/dígito verificador/);
  });

  it('modelo diferente de 65 (NF-e) e UF inexistente são recusados', () => {
    expect(() => parseNfceQr(`https://qualquer.sefaz/qr?p=${keyFor('35', '55')}|2|1`)).toThrow(/não é de uma NFC-e/);
    expect(() => parseNfceQr(`https://qualquer.sefaz/qr?p=${keyFor('99')}|2|1`)).toThrow(/UF desconhecida/);
  });

  it('QR sem chave não é nota fiscal', () => {
    for (const c of ['não é url', 'https://example.com/pagina', 'https://x.sefaz/qr?p=123|2|1', '']) {
      expect(() => parseNfceQr(c), c).toThrow(NfceError);
    }
  });
});

describe('parsePage e toResult', () => {
  it('extrai os dados da nota e confere com a chave', () => {
    const qr = parseNfceQr(CANONICAL);
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
    expect(() => toResult(parseNfceQr(CANONICAL), data)).toThrow(/recusou/);
  });

  it('captcha é detectado como bloqueio', () => {
    const data = parsePage(page({ extra: '<div class="g-recaptcha"></div>' }));
    expect(() => toResult(parseNfceQr(CANONICAL), data)).toThrow(/captcha/);
  });

  it('layout desconhecido não vira dado errado', () => {
    expect(() => toResult(parseNfceQr(CANONICAL), parsePage('<html>nova página</html>'))).toThrow(/ler os dados/);
  });

  it('CNPJ ou mês diferentes da chave são recusados', () => {
    const qr = parseNfceQr(CANONICAL);
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

// ---- Itens da nota: HTML fictício com a mesma estrutura da página da SEFAZ-SP ----

function itemRow(n: number, item: { name: string; code?: string; qty: string; unit: string; unitPrice: string; total: string }): string {
  return `<tr id="Item + ${n}">
    <td valign="top">
      <span class="txtTit">${item.name}</span>
      ${item.code ? `<span class="RCod"> (Código: ${item.code} ) </span>` : ''}
      <br>
      <span class="Rqtd"> <strong>Qtde.:</strong>${item.qty}</span>
      <span class="RUN"> <strong>UN: </strong>${item.unit}</span>
      <span class="RvlUnit"> <strong>Vl. Unit.:</strong> ${item.unitPrice}</span>
    </td>
    <td align="right" valign="top" class="txtTit noWrap"> Vl. Total <br><span class="valor">${item.total}</span></td>
  </tr>`;
}

function itemsPage(rows: string[], totals: string, payments: string): string {
  return `<html><body>
    <table border="0" id="tabResult" class="filterable">${rows.join('\n')}</table>
    <div id="totalNota" class="txtRight">
      <div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">${rows.length}</span></div>
      ${totals}
      <div id="linhaForma"><label>Forma de pagamento:</label><span class="totalNumb txtTitR">Valor pago R$:</span></div>
      ${payments}
      <div id="linhaTotal" class="spcTop"><label class="txtObs">Informação dos Tributos Totais Incidentes</label><span class="totalNumb txtObs">3,21</span></div>
    </div>
  </body></html>`;
}

const total = (label: string, value: string, extra = '') =>
  `<div id="linhaTotal"${extra}><label>${label}</label><span class="totalNumb${extra ? ' txtMax' : ''}">${value}</span></div>`;
const pay = (method: string, value: string) => `<div id="linhaTotal"><label class="tx"> ${method} </label><span class="totalNumb">${value}</span></div>`;

describe('parseItems', () => {
  const rows = [
    itemRow(1, { name: 'ARROZ TIPO 1 5KG', code: '7891', qty: '2', unit: 'UN', unitPrice: '25,90', total: '51,80' }),
    itemRow(2, { name: 'BANANA PRATA', code: '12', qty: '1,535', unit: 'KG', unitPrice: '6,999', total: '10,74' }),
    itemRow(3, { name: 'P&Atilde;O FRANC&Ecirc;S', qty: '6', unit: 'UN', unitPrice: '0,90', total: '5,40' }),
  ];

  it('lê itens (quantidade fracionada, unitário com 3 casas, entidades) e o pagamento', () => {
    const page = itemsPage(rows, total('Valor a pagar R$:', '67,94', ' class="linhaShade"'), pay('Cartão de Crédito', '67,94'));
    const r = parseItems(page);
    expect(r?.items).toEqual([
      { description: 'ARROZ TIPO 1 5KG', code: '7891', quantity: 2, unit: 'UN', unitPrice: '25,90', totalCents: 5180 },
      { description: 'BANANA PRATA', code: '12', quantity: 1.535, unit: 'KG', unitPrice: '6,999', totalCents: 1074 },
      { description: 'PÃO FRANCÊS', quantity: 6, unit: 'UN', unitPrice: '0,90', totalCents: 540 },
    ]);
    expect(r).toMatchObject({ itemsSumCents: 6794, discountCents: 0, totalCents: 6794, consistent: true });
    expect(r?.payments).toEqual([{ method: 'Cartão de Crédito', amountCents: 6794 }]);
  });

  it('com desconto, valor total, dois meios de pagamento e troco', () => {
    const totals = total('Valor total R$:', '67,94') + total('Descontos R$:', '2,94') + total('Valor a pagar R$:', '65,00', ' class="linhaShade"');
    const r = parseItems(itemsPage(rows, totals, pay('Dinheiro', '50,00') + pay('Cartão de Débito', '20,00') + pay('Troco', '5,00')));
    expect(r).toMatchObject({ grossCents: 6794, discountCents: 294, totalCents: 6500, changeCents: 500, consistent: true });
    expect(r?.payments.map((p) => p.method)).toEqual(['Dinheiro', 'Cartão de Débito']);
  });

  it('soma que não bate: guarda os itens, com consistent false', () => {
    const r = parseItems(itemsPage(rows, total('Valor a pagar R$:', '70,00', ' class="linhaShade"'), pay('Pix', '70,00')));
    expect(r).toMatchObject({ itemsSumCents: 6794, totalCents: 7000, consistent: false });
    expect(r?.items).toHaveLength(3);
  });

  it('sem itens, sem total ou com layout desconhecido: null (nada inventado)', () => {
    expect(parseItems(itemsPage([], total('Valor a pagar R$:', '0,00'), ''))).toBeNull();
    expect(parseItems(itemsPage(rows, '', ''))).toBeNull();
    expect(parseItems('<html>nova página</html>')).toBeNull();
    const broken = rows[0].replace('class="valor"', 'class="outro"');
    expect(parseItems(itemsPage([broken], total('Valor a pagar R$:', '51,80'), ''))).toBeNull();
  });
});

describe('checkItems', () => {
  it('soma − descontos = total; valor total, se houver, = soma', () => {
    expect(checkItems({ itemsSumCents: 1000, discountCents: 0, totalCents: 1000 })).toBe(true);
    expect(checkItems({ itemsSumCents: 1000, discountCents: 100, totalCents: 900 })).toBe(true);
    expect(checkItems({ itemsSumCents: 1000, discountCents: 100, totalCents: 1000 })).toBe(false);
    expect(checkItems({ itemsSumCents: 1000, discountCents: 0, totalCents: 1000, grossCents: 990 })).toBe(false);
  });
});
