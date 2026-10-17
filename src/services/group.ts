import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface InviteResult {
  groupId: string;
  /** Formato de exibição: `K7Q-4M2`. */
  code: string;
  /** Epoch em ms. */
  expiresAt: number;
}

/** Erro do vínculo com mensagem pronta para exibir. */
export class GroupError extends Error {}

// As Functions já devolvem mensagens em pt-BR; aqui só tratamos a falta de conexão.
async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  try {
    const result = await httpsCallable<Req, Res>(functions, name)(data);
    return result.data;
  } catch (err) {
    if (!navigator.onLine || (err instanceof FirebaseError && err.code === 'functions/unavailable')) {
      throw new GroupError('Sem conexão. O vínculo precisa de internet.');
    }
    // 'functions/internal' traz só "internal": erro inesperado, sem mensagem útil.
    if (err instanceof FirebaseError && err.code !== 'functions/internal') {
      throw new GroupError(err.message);
    }
    throw new GroupError('Algo deu errado. Tente de novo.');
  }
}

export function createGroup(): Promise<InviteResult> {
  return call<Record<string, never>, InviteResult>('createGroup', {});
}

export function renewInvite(): Promise<InviteResult> {
  return call<Record<string, never>, InviteResult>('renewInvite', {});
}

export function joinGroup(code: string): Promise<{ groupId: string }> {
  return call<{ code: string }, { groupId: string }>('joinGroup', { code });
}
