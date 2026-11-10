import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wholeReais } from './money';
import { partTagsForViewer } from './parts';
import { rowAmountText } from '@/services/expenseView';
import { rowIcons } from '@/services/rowIcons';
import type { Expense } from '@/services/expenses';

describe('valor sem centavos: só dentro das etiquetas de parte', () => {
  it.each([
    [12149, '121'],
    [12150, '122'],
    [12177, '122'],
    [129990, '1.300'],
    [50, '1'],
    [0, '0'],
    [1, '<1'],
    [49, '<1'],
    [99, '1'],
    [123456789, '1.234.568'],
  ])('%i centavos → "%s"', (cents, text) => {
    expect(wholeReais(cents)).toBe(text);
  });
});

describe('o valor do gasto na lista do Painel tem centavos (v0.9.3)', () => {
  const A = 'uid-a';
  const B = 'uid-b';
  const expense = (o: Partial<Expense>): Expense =>
    ({
      id: 'e1', description: 'Mercado', totalCents: 12177, personalCents: 0, payerUid: A, payerSharePct: 50,
      date: '2026-11-05', competence: '2026-11', receipt: { type: 'none' }, status: 'pending_approval', createdBy: A,
      createdAt: null, updatedAt: null, pendingWrite: false, ...o,
    }) as Expense;

  it('"Só minha" de R$ 121,77: a linha mostra os centavos; só a etiqueta mostra "122"', () => {
    const e = expense({ totalCents: 30000, personalCents: 12177 });
    expect(rowAmountText(e)).toBe('R$ 178,23'); // o rateio, com centavos
    const icons = rowIcons(e, A, 'Queila', undefined, { partnerUid: B, initialOf: (u) => (u === A ? 'R' : 'Q') });
    expect(icons.parts).toEqual([{ initial: 'R', text: '122', filled: true, label: 'Só meu R$ 121,77' }]);
  });

  it('R$ 121,77 e R$ 1.299,90 aparecem com centavos; a confirmar continua "a confirmar"', () => {
    expect(rowAmountText(expense({ totalCents: 12177 }))).toBe('R$ 121,77');
    expect(rowAmountText(expense({ totalCents: 129990 }))).toBe('R$ 1.299,90');
    expect(rowAmountText(expense({ status: 'awaiting_confirmation', totalCents: 0 }))).toBe('a confirmar');
  });

  it('nenhum arquivo do app arredonda valor fora das etiquetas de parte', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|vue)$/.test(name) && !/\.spec\.ts$/.test(name)) files.push(path);
      }
    };
    walk('src');
    const using = files.filter((f) => /wholeReais|formatBRLWhole|maximumFractionDigits:\s*0/.test(readFileSync(f, 'utf8')));
    // money.ts define wholeReais; rowIcons.ts é o único que o usa (as etiquetas).
    expect(using.map((f) => f.replace(/\\/g, '/')).sort()).toEqual(['src/domain/money.ts', 'src/services/rowIcons.ts']);
  });
});

describe('etiquetas: banco (quem pagou) → quem vê', () => {
  const A = 'uid-a';
  const B = 'uid-b';
  const e = { personalCents: 5000, partnerOnlyCents: 3000 };

  it('A pagou: A vê a pessoal como sua (preenchida) e a do parceiro como de B (vazada)', () => {
    expect(partTagsForViewer({ ...e, payerUid: A }, A, B)).toEqual([
      { owner: 'viewer', ownerUid: A, cents: 5000 },
      { owner: 'partner', ownerUid: B, cents: 3000 },
    ]);
  });

  it('o mesmo gasto visto por B: a parte de B primeiro, preenchida; os donos não mudam', () => {
    expect(partTagsForViewer({ ...e, payerUid: A }, B, A)).toEqual([
      { owner: 'viewer', ownerUid: B, cents: 3000 },
      { owner: 'partner', ownerUid: A, cents: 5000 },
    ]);
  });

  it('B pagou: a pessoal é de B e a do parceiro é de A', () => {
    expect(partTagsForViewer({ ...e, payerUid: B }, A, B)).toEqual([
      { owner: 'viewer', ownerUid: A, cents: 3000 },
      { owner: 'partner', ownerUid: B, cents: 5000 },
    ]);
  });

  it('só as partes maiores que zero; parte do parceiro ausente = 0', () => {
    expect(partTagsForViewer({ personalCents: 0, payerUid: A }, A, B)).toEqual([]);
    expect(partTagsForViewer({ personalCents: 700, payerUid: B }, A, B)).toEqual([{ owner: 'partner', ownerUid: B, cents: 700 }]);
  });
});
