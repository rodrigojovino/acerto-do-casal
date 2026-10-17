import { onAuthStateChanged, type User } from 'firebase/auth';
import { readonly, ref } from 'vue';
import { auth } from './firebase';

const currentUser = ref<User | null>(null);
let resolveReady: () => void;
const ready = new Promise<void>((resolve) => (resolveReady = resolve));

// O Firebase restaura a sessão salva de forma assíncrona; o primeiro
// disparo diz se há alguém logado.
onAuthStateChanged(auth, (user) => {
  currentUser.value = user;
  resolveReady();
});

/** Usuário logado (reativo). */
export const user = readonly(currentUser);

/** Resolve quando o estado inicial de login já é conhecido. */
export function authReady(): Promise<void> {
  return ready;
}
