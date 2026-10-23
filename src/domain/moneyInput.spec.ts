import { describe, expect, it } from 'vitest';
import { applyMoneyEdit, caretForDigitsRight, digitsRightOf, normalizeMoneyText, type MoneyEdit } from './moneyInput';
import { formatBRL } from './money';

/** Texto com o cursor marcado por "|" → [texto, posição]. */
function at(marked: string): [string, number] {
  const i = marked.indexOf('|');
  return [marked.replace('|', ''), i];
}

/** Aplica a edição no texto marcado e devolve o resultado marcado ("R$ 51|4,00"), ou null. */
function run(marked: string, edit: MoneyEdit): string | null {
  const [text, caret] = at(marked);
  const r = applyMoneyEdit(text, caret, caret, edit);
  return r && r.text.slice(0, r.caret) + '|' + r.text.slice(r.caret);
}

const type = (d: string): MoneyEdit => ({ type: 'insert', text: d });
const back: MoneyEdit = { type: 'backspace' };

describe('posição do cursor por dígitos à direita', () => {
  it('conta só os dígitos', () => {
    expect(digitsRightOf('R$ 1.234,56', 5)).toBe(5); // "234,56"
    expect(digitsRightOf('R$ 1.234,56', 11)).toBe(0);
  });

  it('volta ao ponto lógico, colado no dígito da esquerda', () => {
    expect(caretForDigitsRight('R$ 1.234,56', 0)).toBe(11);
    expect(caretForDigitsRight('R$ 1.234,56', 2)).toBe(8); // depois do 4, antes da vírgula
    expect(caretForDigitsRight('R$ 1.234,56', 5)).toBe(4); // depois do 1, antes do ponto
    expect(caretForDigitsRight('R$ 1.234,56', 99)).toBe(3); // antes do primeiro dígito
  });
});

describe('com o cursor no fim', () => {
  it('5, 1, 4, 0, 0 = R$ 514,00', () => {
    let marked = `${formatBRL(0)}|`;
    for (const d of ['5', '1', '4', '0', '0']) marked = run(marked, type(d))!;
    expect(marked).toBe('R$ 514,00|');
  });

  it('apagar no fim volta dígito a dígito até zero', () => {
    expect(run('R$ 514,00|', back)).toBe('R$ 51,40|');
    expect(run('R$ 0,05|', back)).toBe('R$ 0,00|');
    expect(run('R$ 0,00|', back)).toBe('R$ 0,00|'); // zeros: continua zero
  });
});

describe('no meio', () => {
  it('inserir entre dígitos', () => {
    // 51|4,00 + 7 → 5.17|4,00 (o cursor fica antes do 4, já com o ponto de milhar)
    expect(run('R$ 51|4,00', type('7'))).toBe('R$ 5.17|4,00');
  });

  it('apagar no meio remove o dígito à esquerda do cursor', () => {
    expect(run('R$ 1.2|34,56', back)).toBe('R$ 1|34,56');
  });

  it('apagar logo depois de vírgula ou ponto remove o dígito antes do separador', () => {
    expect(run('R$ 514,|00', back)).toBe('R$ 51|,00'); // remove o 4
    expect(run('R$ 1.|234,56', back)).toBe('R$ |234,56'); // remove o 1
  });

  it('inserir à esquerda de zeros à esquerda', () => {
    expect(run('R$ 0,0|5', type('3'))).toBe('R$ 0,3|5');
  });

  it('apagar no começo não faz nada', () => {
    expect(run('R$ |514,00', back)).toBeNull();
    expect(run('|R$ 514,00', back)).toBeNull();
  });
});

describe('mudança de milhar', () => {
  it('ao ganhar o ponto, o cursor continua no mesmo ponto lógico', () => {
    expect(run('R$ 999,99|', type('1'))).toBe('R$ 9.999,91|');
    expect(run('R$ 9|99,99', type('1'))).toBe('R$ 9.1|99,99');
  });

  it('ao perder o ponto, também', () => {
    expect(run('R$ 1.000,0|0', back)).toBe('R$ 100,0|0');
  });
});

describe('outros casos', () => {
  it('tecla que não é dígito não muda nada; colar aproveita só os dígitos', () => {
    expect(run('R$ 5,00|', type('a'))).toBeNull();
    expect(run('R$ 0,00|', type('R$ 12,34'))).toBe('R$ 12,34|');
  });

  it('não passa do limite de R$ 9.999.999,99', () => {
    expect(run('R$ 9.999.999,99|', type('1'))).toBeNull();
  });

  it('Delete remove o dígito à direita', () => {
    expect(run('R$ 51|4,00', { type: 'delete' })).toBe('R$ 51|,00');
  });

  it('seleção: digitar substitui, apagar remove o selecionado', () => {
    const text = 'R$ 1.234,56';
    const r = applyMoneyEdit(text, 3, text.length, type('9'))!; // tudo selecionado
    expect([r.text, r.caret]).toEqual(['R$ 0,09', 7]);
    const b = applyMoneyEdit(text, 5, 8, back)!; // "234" selecionado
    expect(b.text.slice(0, b.caret) + '|' + b.text.slice(b.caret)).toBe('R$ 1|,56');
  });

  it('reserva (teclado sem beforeinput): reconstrói pelo texto já mudado', () => {
    // O navegador inseriu "7" em "R$ 51|4,00" → "R$ 517|4,00", cursor depois do 7.
    const r = normalizeMoneyText('R$ 5174,00', 6)!;
    expect(r.text.slice(0, r.caret) + '|' + r.text.slice(r.caret)).toBe('R$ 5.17|4,00');
  });
});
