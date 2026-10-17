import { randomInt } from 'node:crypto';

/** Sem 0/O e 1/I/L, para o código ser lido e digitado sem confusão. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_LENGTH = 6;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Gera um código aleatório (CSPRNG) no formato interno, sem hífen: `K7Q4M2`. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i++) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normaliza o que a pessoa digitou: maiúsculas, sem hífen nem espaços.
 * Retorna `null` se o resultado não for um código possível.
 */
export function normalizeInviteCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== INVITE_LENGTH) return null;
  for (const ch of code) {
    if (!INVITE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

/** Formato de exibição: `K7Q-4M2`. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
