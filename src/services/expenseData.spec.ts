import { describe, expect, it } from 'vitest';
import { closeBlockers } from '@/domain/closing';
import { receiptData, type StoredReceipt } from './expenseData';
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
    const attached = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'read', photo: { replaced: true } }, ids, ok);
    expect(attached).toEqual({ ...ok, photoPath, photoUploaded: false });
    const kept = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'read', photo: { replaced: false } }, ids, { ...ok, photoPath, photoUploaded: true });
    expect(kept).toMatchObject({ photoUploaded: true, nfceStatus: 'ok' });
    const removed = receiptData({ type: 'nfce', nfceKey: KEY, entry: 'read' }, ids, { ...ok, photoPath, photoUploaded: true });
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
