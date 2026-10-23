import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_ID, createTestEnv } from './setup';

// Varredura das fotos órfãs (a mesma função da Function semanal), com o Admin
// SDK contra os emuladores de Firestore e Storage do projeto de teste.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { cleanOrphans, storedFiles } = await import('../../functions/src/photoCleanup');

// O bucket padrão do emulador tem o id do projeto como nome.
const BUCKET = PROJECT_ID;
const G = 'grupo-fotos';
const A = 'uid-a';
const B = 'uid-b';
const DAY = 24 * 60 * 60 * 1000;
/** Daqui a 8 dias: tudo o que foi enviado agora já passou do prazo de 7 dias. */
const later = () => new Date(Date.now() + 8 * DAY);

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const receipt = (id: string) => `groups/${G}/receipts/${id}.jpg`;
const settlement = (month: string, id: string) => `groups/${G}/settlements/${month}/${id}.jpg`;
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

async function upload(...paths: string[]): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const p of paths) await ctx.storage().ref(p).put(jpeg(), { contentType: 'image/jpeg' });
  });
}

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(path).set(data));
}

async function remaining(): Promise<string[]> {
  return (await storedFiles(BUCKET)).map((f) => f.path).sort();
}

const photoReceipt = (id: string) => ({ type: 'photo', photoPath: receipt(id), photoUploaded: true });

beforeEach(async () => {
  await env.clearFirestore();
  // O clearStorage não limpa o bucket padrão do emulador: apaga arquivo por arquivo.
  const leftovers = await storedFiles(BUCKET);
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const f of leftovers) await ctx.storage().ref(f.path).delete();
  });
  await seed(`groups/${G}`, { members: [A, B] });
});

describe('fotos órfãs', () => {
  it('apaga só o que nenhum gasto nem pagamento usa, e só depois do prazo', async () => {
    await upload(receipt('usada'), receipt('trocou-para-chave'), receipt('excluido'), receipt('nota-com-foto'));
    await seed(`groups/${G}/expenses/usada`, { receipt: photoReceipt('usada') });
    await seed(`groups/${G}/expenses/trocou-para-chave`, { receipt: { type: 'nfce', nfceKey: '3'.repeat(44), nfceStatus: 'unchecked' } });
    await seed(`groups/${G}/expenses/nota-com-foto`, {
      receipt: { type: 'nfce', nfceKey: '5'.repeat(44), nfceStatus: 'unchecked', photoPath: receipt('nota-com-foto'), photoUploaded: true },
    });
    // "excluido": o gasto não existe mais (excluído offline).

    // Agora: tudo recente, nada sai.
    const now = await cleanOrphans(new Date(), true, BUCKET);
    expect(now).toMatchObject({ files: 4, referenced: 2, recent: 2, deleted: 0 });

    // Depois do prazo: saem as duas órfãs; a foto de recibo e a da nota ficam.
    const after = await cleanOrphans(later(), true, BUCKET);
    expect(after).toMatchObject({ files: 4, referenced: 2, deleted: 2, byKind: { receipt: 2, settlement: 0 } });
    expect(await remaining()).toEqual([receipt('nota-com-foto'), receipt('usada')]);
  });

  it('série: a foto da compra fica enquanto qualquer parcela a usa, inclusive de mês fechado', async () => {
    await upload(receipt('serie1'));
    // As parcelas abertas trocaram para "sem comprovante"; a de mês fechado (parcela 1) mantém a foto.
    await seed(`groups/${G}/months/2026-08`, { status: 'closed' });
    await seed(`groups/${G}/expenses/serie1`, { competence: '2026-08', receipt: photoReceipt('serie1'), installment: { seriesId: 'serie1', index: 1 } });
    await seed(`groups/${G}/expenses/serie1-2`, { competence: '2026-09', receipt: { type: 'none' }, installment: { seriesId: 'serie1', index: 2 } });
    const r = await cleanOrphans(later(), true, BUCKET);
    expect(r).toMatchObject({ referenced: 1, deleted: 0 });
    expect(await remaining()).toEqual([receipt('serie1')]);
  });

  it('comprovante PIX de pagamento registrado nunca sai; o sem pagamento sai depois do prazo', async () => {
    await upload(settlement('2026-09', 'pago'), settlement('2026-09', 'sem-pagamento'));
    await seed(`groups/${G}/months/2026-09`, {
      status: 'closed',
      payments: [
        { id: 'pago', method: 'pix', receiptPath: settlement('2026-09', 'pago'), amountCents: 10000 },
        { id: 'dinheiro', method: 'cash', amountCents: 500 },
      ],
    });
    const r = await cleanOrphans(new Date(Date.now() + 400 * DAY), true, BUCKET);
    expect(r).toMatchObject({ files: 2, referenced: 1, deleted: 1, byKind: { receipt: 0, settlement: 1 } });
    expect(await remaining()).toEqual([settlement('2026-09', 'pago')]);
  });

  it('simulação só conta, não apaga', async () => {
    await upload(receipt('orfa'));
    const r = await cleanOrphans(later(), false, BUCKET);
    expect(r).toMatchObject({ files: 1, deleted: 0, byKind: { receipt: 1 } });
    expect(r.orphans).toHaveLength(1);
    expect(await remaining()).toEqual([receipt('orfa')]);
  });

  it('arquivo de um grupo que não existe mais é órfão', async () => {
    await upload('groups/grupo-apagado/receipts/x.jpg');
    const r = await cleanOrphans(later(), true, BUCKET);
    expect(r.deleted).toBe(1);
    expect(await remaining()).toEqual([]);
  });
});
