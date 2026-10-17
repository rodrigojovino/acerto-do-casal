import { Capacitor } from '@capacitor/core';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// Config web do Firebase: pública por natureza; a proteção vem das regras.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const FIREBASE_REGION = 'southamerica-east1';

export const app = initializeApp(firebaseConfig);

// Na WebView do Capacitor, o getAuth padrão carrega o resolvedor de popup/redirect
// e pode travar; no aparelho a sessão fica só no IndexedDB.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : getAuth(app);

// Cache local persistente (IndexedDB) para o app funcionar offline.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);

export const functions = getFunctions(app, FIREBASE_REGION);

// Em desenvolvimento, `VITE_USE_EMULATORS=true` aponta tudo para os emuladores locais
// (`npm run emulators`). Nunca vale em build de produção.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}
