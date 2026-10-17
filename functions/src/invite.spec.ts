import { describe, expect, it } from 'vitest';
import {
  INVITE_ALPHABET,
  INVITE_LENGTH,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
} from './invite';

describe('generateInviteCode', () => {
  it('gera códigos de 6 caracteres só do alfabeto sem ambiguidade', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_LENGTH);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    }
  });

  it('o alfabeto não tem caracteres confundíveis', () => {
    for (const ch of '01OIL') expect(INVITE_ALPHABET).not.toContain(ch);
  });
});

describe('normalizeInviteCode', () => {
  it('aceita minúsculas, hífen e espaços', () => {
    expect(normalizeInviteCode('k7q-4m2')).toBe('K7Q4M2');
    expect(normalizeInviteCode(' K7Q 4M2 ')).toBe('K7Q4M2');
  });

  it('recusa tamanho errado e caracteres fora do alfabeto', () => {
    expect(normalizeInviteCode('K7Q4M')).toBeNull();
    expect(normalizeInviteCode('K7Q4M22')).toBeNull();
    expect(normalizeInviteCode('K0Q4M2')).toBeNull();
    expect(normalizeInviteCode('K7Q/M2')).toBeNull();
  });
});

describe('formatInviteCode', () => {
  it('separa em dois grupos de 3', () => {
    expect(formatInviteCode('K7Q4M2')).toBe('K7Q-4M2');
  });
});
