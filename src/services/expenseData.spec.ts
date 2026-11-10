import { describe, expect, it } from 'vitest';
import { closeBlockers } from '@/domain/closing';
import { checkDigit } from '../../functions/src/nfce';
import { expenseUpdateData, fiscalKeyChange, installmentUpdateData, newExpenseData, newInstallmentSeriesData, receiptData, type StoredReceipt } from './expenseData';
import { flagsFor, originLabel } from './expenseView';

// Chaves fictícias (NF-e de MG, modelo 55): sem consulta, comprovante "unchecked".
const KEY = '31' + '2'.repeat(18) + '55' + '3'.repeat(22);
const ids = { groupId: 'g', expenseId: 'e1' };
const photoPath = 'groups/g/receipts/e1.jpg';

describe('foto da nota junto com a chave', () => {
  it('chave nova com foto: a foto vai no caminho do gasto, ainda não enviada', () => {
    expect(receiptData({ type: 'nfce', nfceKey: KEY, entry: 'typed', photo: { replaced: true } }, ids)).toEqual({
      type: 'nfce',
      nfceKey: KEY,
      entry: 'typed',
      nfceStatus: 'unchecked',
      photoPath,
      photoUploaded: false,
    });
  });

  it('mesma chave: a conferência fica; anexar, manter ou remover só mexe na foto', () => {
    const ok: StoredReceipt = { type: 'nfce', nfceKey: KEY, entry: 'read', nfceStatus: 'ok', nfceData: { issuerName: 'LOJA', totalCents: 100, date: '2026-10-01' } };
    const attached = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'qr', photo: { replaced: true } }, ids, ok);
    expect(attached).toEqual({ ...ok, photoPath, photoUploaded: false });
    const kept = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'qr', photo: { replaced: false } }, ids, { ...ok, photoPath, photoUploaded: true });
    expect(kept).toMatchObject({ photoUploaded: true, nfceStatus: 'ok' });
    const removed = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'qr' }, ids, { ...ok, photoPath, photoUploaded: true });
    expect(removed).toEqual(ok);
  });

  it('foto ainda não enviada: marca no Painel e bloqueia o fechamento; origem diz "com foto"', () => {
    const receipt: StoredReceipt = { type: 'nfce', nfceKey: KEY, entry: 'read', nfceStatus: 'unchecked', photoPath, photoUploaded: false };
    expect(flagsFor({ receipt, totalCents: 100, status: 'confirmed' })).toEqual(['photo-missing']);
    expect(closeBlockers([{ status: 'confirmed', receipt }])).toEqual([{ kind: 'photo', count: 1 }]);
    expect(closeBlockers([{ status: 'confirmed', receipt: { ...receipt, photoUploaded: true } }])).toEqual([]);
    expect(originLabel({ status: 'confirmed', receipt }, () => '')).toBe('NF-e · chave lida · com foto');
  });
});

describe('registro da nota fiscal (fiscalKeyChange)', () => {
  const OTHER = '35' + '2'.repeat(18) + '65' + '4'.repeat(22);
  const nfce = (nfceKey: string): StoredReceipt & { type: 'nfce' } => ({ type: 'nfce', nfceKey, entry: 'read', nfceStatus: 'unchecked' });
  const none: StoredReceipt = { type: 'none' };

  it('criar com chave registra; sem chave, nada', () => {
    expect(fiscalKeyChange(undefined, nfce(KEY))).toEqual({ release: null, register: KEY });
    expect(fiscalKeyChange(undefined, none)).toEqual({ release: null, register: null });
  });

  it('editar mantendo a chave (até só a foto) não mexe no registro', () => {
    expect(fiscalKeyChange(nfce(KEY), { ...nfce(KEY), photoPath, photoUploaded: false })).toEqual({ release: null, register: null });
  });

  it('trocar a chave solta a antiga e registra a nova; tirar a chave só solta', () => {
    expect(fiscalKeyChange(nfce(KEY), nfce(OTHER))).toEqual({ release: KEY, register: OTHER });
    expect(fiscalKeyChange(nfce(KEY), none)).toEqual({ release: KEY, register: null });
    expect(fiscalKeyChange(none, nfce(OTHER))).toEqual({ release: null, register: OTHER });
  });

  it('excluir solta a chave', () => {
    expect(fiscalKeyChange(nfce(KEY), undefined)).toEqual({ release: KEY, register: null });
  });
});

describe('categoria', () => {
  const input = {
    description: 'Mercado',
    totalCents: 10000,
    personalCents: 0,
    payerUid: 'a',
    payerSharePct: 50,
    date: '2026-10-05',
    receipt: { type: 'none' as const },
  };
  const current = { receipt: { type: 'none' as const }, status: 'pending_approval' as const };

  it('gravada quando escolhida; sem categoria, o campo não existe', () => {
    expect(newExpenseData({ ...input, categoryId: 'c1' }, 'a', '2026-10', ids, 'agora').categoryId).toBe('c1');
    expect(newExpenseData(input, 'a', '2026-10', ids, 'agora')).not.toHaveProperty('categoryId');
  });

  it('edição sem categoria tira o campo; série leva a mesma em todas as parcelas', () => {
    expect(expenseUpdateData(input, '2026-10', ids, current, 'agora', 'APAGAR').categoryId).toBe('APAGAR');
    expect(installmentUpdateData({ ...input, categoryId: 'c2' }, current, { groupId: 'g', seriesId: 's' }, 'agora', 'APAGAR').categoryId).toBe('c2');
    const parcels = newInstallmentSeriesData({ ...input, categoryId: 'c3' }, { count: 3, firstMonth: '2026-10' }, 'a', { groupId: 'g', seriesId: 's' }, 'agora');
    expect(parcels.map((p) => p.data.categoryId)).toEqual(['c3', 'c3', 'c3']);
  });
});

describe('NFC-e de SP: estado depois das tentativas do formulário', () => {
  // Chave fictícia de NFC-e de SP (modelo 65), com dígito verificador válido.
  const base = `35261011222333000181650${'7'.padStart(20, '0')}`;
  const spKey = base + checkDigit(base);

  it("sem indicação: 'pending'; depois das duas tentativas: 'unchecked', sempre com a URL", () => {
    const pending = receiptData({ type: 'nfce', nfceKey: spKey, entry: 'qr' }, ids);
    expect(pending).toMatchObject({ nfceStatus: 'pending', nfceUrl: expect.stringContaining(spKey) });
    const done = receiptData({ type: 'nfce', nfceKey: spKey, entry: 'qr', sefaz: 'unchecked' }, ids);
    expect(done).toMatchObject({ nfceStatus: 'unchecked', nfceUrl: expect.stringContaining(spKey) });
  });

  it('nota de outro estado continua unchecked, sem URL', () => {
    expect(receiptData({ type: 'nfce', nfceKey: KEY, entry: 'qr', sefaz: 'pending' }, ids)).toMatchObject({ nfceStatus: 'unchecked' });
  });
});

describe('parte do parceiro e marcações dos itens (v0.9.2)', () => {
  const base = {
    description: 'Mercado',
    totalCents: 10000,
    personalCents: 1000,
    payerUid: 'a',
    payerSharePct: 50,
    date: '2026-11-05',
    receipt: { type: 'nfce' as const, nfceKey: KEY, entry: 'typed' as const },
  };

  it('com comprovante e 50/50, a parte do parceiro manda para aprovação', () => {
    expect(newExpenseData(base, 'a', '2026-11', ids, 'T').status).toBe('confirmed');
    const withPartner = newExpenseData({ ...base, partnerOnlyCents: 2000 }, 'a', '2026-11', ids, 'T');
    expect(withPartner).toMatchObject({ status: 'pending_approval', partnerOnlyCents: 2000 });
    expect(withPartner).not.toHaveProperty('everConfirmed');
  });

  it('sem parte do parceiro, o campo não existe; na edição, zerar tira o campo', () => {
    expect(newExpenseData(base, 'a', '2026-11', ids, 'T')).not.toHaveProperty('partnerOnlyCents');
    const edit = expenseUpdateData({ ...base, partnerOnlyCents: 0 }, '2026-11', ids, { receipt: { type: 'none' }, status: 'pending_approval' }, 'T', 'DEL');
    expect(edit.partnerOnlyCents).toBe('DEL');
    expect(edit.itemMarks).toBe('DEL');
  });

  it('série: as partes vão para as parcelas (somas exatas) e as marcações só na parcela 1', () => {
    const marks = { m: 'sps', sig: '0a1b2c3d' };
    const parcels = newInstallmentSeriesData(
      { ...base, totalCents: 100000, personalCents: 1001, partnerOnlyCents: 2999, itemMarks: marks },
      { count: 3, firstMonth: '2026-11' },
      'a',
      { groupId: 'g', seriesId: 's' },
      'T',
    );
    const sum = (k: 'personalCents' | 'partnerOnlyCents') => parcels.reduce((s, p) => s + ((p.data as unknown as Record<string, number | undefined>)[k] ?? 0), 0);
    expect(sum('personalCents')).toBe(1001);
    expect(sum('partnerOnlyCents')).toBe(2999);
    expect(parcels.every((p) => p.data.status === 'pending_approval')).toBe(true);
    expect(parcels.map((p) => 'itemMarks' in p.data)).toEqual([true, false, false]);
  });

  it('edição da série com parte do parceiro: anexar comprovante não confirma', () => {
    const data = installmentUpdateData(
      { description: 'X', payerUid: 'a', payerSharePct: 50, receipt: { type: 'nfce', nfceKey: KEY, entry: 'typed' } },
      { receipt: { type: 'none' }, status: 'pending_approval', partnerOnlyCents: 500 },
      { groupId: 'g', seriesId: 's' },
      'T',
      'DEL',
    );
    expect(data.status).toBe('pending_approval');
  });
});
