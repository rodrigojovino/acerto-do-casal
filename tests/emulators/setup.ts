import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { readFileSync } from 'node:fs';

// Projeto "demo-": os emuladores garantem que nada chega a um projeto real.
export const PROJECT_ID = 'demo-acerto';
const HOST = '127.0.0.1';

export function createTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: HOST, port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: HOST, port: 9199 },
  });
}

/** Apaga as contas do emulador de Auth. */
export async function clearAuth(): Promise<void> {
  await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

export interface TestUser {
  uid: string;
  app: FirebaseApp;
  call: <Res = unknown>(name: string, data?: unknown) => Promise<Res>;
}

const apps: FirebaseApp[] = [];

/**
 * Cliente logado no emulador de Auth como um usuário Google fictício.
 * O emulador aceita um idToken em JSON sem assinatura.
 */
export async function signInAs(sub: string, name: string): Promise<TestUser> {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, `app-${sub}-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const functions = getFunctions(app, 'southamerica-east1');
  connectFunctionsEmulator(functions, HOST, 5001);

  const token = JSON.stringify({ sub, email: `${sub}@example.com`, name, email_verified: true });
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  return {
    uid: user.uid,
    app,
    call: async <Res>(fn: string, data: unknown = {}) => (await httpsCallable(functions, fn)(data)).data as Res,
  };
}

/** Cliente sem login, só para chamar Functions. */
export function anonymousCaller(): TestUser['call'] {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, `app-anon-${apps.length}`);
  apps.push(app);
  const functions = getFunctions(app, 'southamerica-east1');
  connectFunctionsEmulator(functions, HOST, 5001);
  return async <Res>(fn: string, data: unknown = {}) => (await httpsCallable(functions, fn)(data)).data as Res;
}

export async function closeApps(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)));
}
