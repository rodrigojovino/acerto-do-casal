import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';
import { toastController } from '@ionic/vue';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { readonly, ref, watch } from 'vue';
import type { Router } from 'vue-router';
import { db } from './firebase';
import { user } from './session';

/**
 * Avisos por push (FCM), só no app Android: permissão (Android 13+), canal,
 * registro do aparelho (um token por usuário e aparelho), toque na
 * notificação abrindo a tela certa e aviso discreto com o app aberto.
 */

export const pushAvailable = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** Canal do Android (o mesmo das Functions). */
const CHANNEL = 'avisos';
const DEVICE_KEY = 'acerto.deviceId';
const ASKED_KEY = 'acerto.pushAsked';

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

const permission = ref<PushPermission>(pushAvailable ? 'prompt' : 'unavailable');
export const pushPermission = readonly(permission);

/** Id estável deste aparelho (o token muda; o documento do aparelho, não). */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function refreshPermission(): Promise<PushPermission> {
  if (!pushAvailable) return 'unavailable';
  const { receive } = await FirebaseMessaging.checkPermissions();
  permission.value = receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
  return permission.value;
}

/** Grava (ou atualiza) o token deste aparelho no usuário logado. */
async function saveToken(token: string): Promise<void> {
  const uid = user.value?.uid;
  if (!uid || !token) return;
  const { version } = await App.getInfo();
  await setDoc(doc(db, 'users', uid, 'devices', deviceId()), {
    token,
    platform: 'android',
    appVersion: version.slice(0, 32),
    updatedAt: serverTimestamp(),
  });
}

async function register(): Promise<void> {
  await FirebaseMessaging.createChannel({
    id: CHANNEL,
    name: 'Avisos do casal',
    description: 'Gastos lançados, devoluções, acerto e recorrentes',
    importance: Importance.High,
  });
  const { token } = await FirebaseMessaging.getToken();
  await saveToken(token);
}

/** "Ativar avisos": pede a permissão do Android (13+) e registra o aparelho. */
export async function enablePush(): Promise<PushPermission> {
  if (!pushAvailable) return 'unavailable';
  localStorage.setItem(ASKED_KEY, '1');
  const { receive } = await FirebaseMessaging.requestPermissions();
  permission.value = receive === 'granted' ? 'granted' : 'denied';
  if (receive === 'granted') await register();
  return permission.value;
}

/** O cartão de explicação do Painel só aparece uma vez (até a pessoa escolher). */
export const pushAskedBefore = () => localStorage.getItem(ASKED_KEY) === '1';
export const dismissPushInvite = () => localStorage.setItem(ASKED_KEY, '1');

/** Ao sair da conta: este aparelho para de receber os avisos dela. */
export async function unregisterDevice(): Promise<void> {
  const uid = user.value?.uid;
  if (!pushAvailable || !uid) return;
  await deleteDoc(doc(db, 'users', uid, 'devices', deviceId())).catch(() => undefined);
  await FirebaseMessaging.deleteToken().catch(() => undefined);
}

let listeners: PluginListenerHandle[] = [];

/**
 * Liga os avisos ao app: token renovado, toque na notificação (abre a rota)
 * e notificação com o app aberto (aviso discreto com "Abrir"). Registra o
 * aparelho sempre que alguém entra com a permissão já concedida.
 */
export function initPush(router: Router): void {
  if (!pushAvailable || listeners.length > 0) return;
  const open = (data: unknown) => {
    const route = (data as { route?: unknown } | undefined)?.route;
    if (typeof route === 'string' && route.startsWith('/')) void router.push(route);
  };
  void Promise.all([
    FirebaseMessaging.addListener('tokenReceived', ({ token }) => void saveToken(token).catch(() => undefined)),
    FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => open(notification.data)),
    FirebaseMessaging.addListener('notificationReceived', async ({ notification }) => {
      const toast = await toastController.create({
        message: notification.body ?? notification.title ?? 'Novo aviso',
        duration: 6000,
        position: 'top',
        buttons: [{ text: 'Abrir', handler: () => open(notification.data) }],
      });
      await toast.present();
    }),
  ]).then((handles) => (listeners = handles));

  watch(
    () => user.value?.uid,
    async (uid) => {
      if (!uid) return;
      if ((await refreshPermission()) === 'granted') await register().catch(() => undefined);
    },
    { immediate: true },
  );
  // Ao voltar ao app, a permissão pode ter mudado nas configurações do Android.
  void App.addListener('resume', () => void refreshPermission());
}
