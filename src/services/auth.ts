import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from '@capacitor/core';
import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

/** Erro de login com mensagem pronta para exibir. */
export class SignInError extends Error {}

/**
 * Login com Google.
 * - Android: seletor de conta nativo; o idToken é repassado ao Firebase JS SDK.
 * - Web: popup; se o navegador bloquear, cai para redirect (a página recarrega).
 * Retorna `null` se a pessoa cancelar.
 */
export async function signInWithGoogle(): Promise<User | null> {
  if (Capacitor.isNativePlatform()) {
    return signInNative();
  }
  return signInWeb();
}

async function signInNative(): Promise<User | null> {
  let idToken: string | undefined;
  try {
    const result = await FirebaseAuthentication.signInWithGoogle();
    idToken = result.credential?.idToken;
  } catch (err) {
    if (isNativeCancel(err)) return null;
    throw new SignInError('Não foi possível entrar com o Google. Tente de novo.');
  }
  if (!idToken) {
    throw new SignInError('O Google não devolveu a credencial. Tente de novo.');
  }
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return user;
}

async function signInWeb(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const { user } = await signInWithPopup(auth, provider);
    return user;
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return null;
      }
      if (err.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return null;
      }
      if (err.code === 'auth/network-request-failed') {
        throw new SignInError('Sem conexão. O primeiro acesso precisa de internet.');
      }
    }
    throw new SignInError('Não foi possível entrar com o Google. Tente de novo.');
  }
}

function isNativeCancel(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('cancel');
}

export async function signOut(): Promise<void> {
  // Este aparelho para de receber os avisos da conta que sai.
  const { unregisterDevice } = await import('./push');
  await unregisterDevice();
  if (Capacitor.isNativePlatform()) {
    // Limpa a conta Google escolhida, para o seletor aparecer no próximo login.
    await FirebaseAuthentication.signOut().catch(() => undefined);
  }
  await firebaseSignOut(auth);
}
