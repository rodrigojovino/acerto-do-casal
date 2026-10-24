import { describe, expect, it } from 'vitest';
import { closeBlockers } from '@/domain/closing';
import { fiscalKeyChange, receiptData, type StoredReceipt } from './expenseData';
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
