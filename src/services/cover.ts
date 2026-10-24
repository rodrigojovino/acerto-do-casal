import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { readonly, shallowRef, watch } from 'vue';
import type { CoverFraming } from '@/domain/cover';
import { COVER_DOC_ID, coverData, coverFramingData, type CoverImage } from './coverData';
import { db } from './firebase';
import { group, user } from './session';
import { trackWrite } from './sync';

/**
 * Foto do casal no cartão de saldo: acompanhada em segundo plano enquanto há
 * grupo (do cache offline também). Gravações sem esperar o servidor.
 */

export interface Cover extends CoverFraming {
  /** `data:image/jpeg;base64,...`, pronta para desenhar. */
  src: string;
  width: number;
  height: number;
  updatedBy: string;
}

const current = shallowRef<Cover | null>(null);
export const cover = readonly(current);

const coverRef = (groupId: string) => doc(db, 'groups', groupId, 'cover', COVER_DOC_ID);

let stop: Unsubscribe | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    current.value = null;
    if (!groupId) return;
    stop = onSnapshot(
      coverRef(groupId),
      (snap) => {
        const d = snap.data();
        current.value =
          d && typeof d.image === 'string'
            ? {
                src: `data:image/jpeg;base64,${d.image}`,
                width: d.width,
                height: d.height,
                x: d.x,
                y: d.y,
                zoom: d.zoom,
                dark: d.dark,
                blur: d.blur,
                updatedBy: d.updatedBy,
              }
            : null;
      },
      () => undefined,
    );
  },
  { immediate: true },
);

/** JPEG comprimido → base64 (sem o prefixo `data:`). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

function ids(): { groupId: string; uid: string } | null {
  const groupId = group.value?.id;
  const uid = user.value?.uid;
  return groupId && uid ? { groupId, uid } : null;
}

/** Foto nova (ou trocada) com o enquadramento. */
export function saveCoverPhoto(photo: CoverImage, framing: CoverFraming): void {
  const c = ids();
  if (!c) return;
  trackWrite(setDoc(coverRef(c.groupId), coverData(photo, framing, c.uid, serverTimestamp())), 'Não foi possível salvar a foto do cartão.');
}

/** Só o enquadramento, o escurecimento e o desfoque. */
export function saveCoverFraming(framing: CoverFraming): void {
  const c = ids();
  if (!c) return;
  trackWrite(updateDoc(coverRef(c.groupId), coverFramingData(framing, c.uid, serverTimestamp())), 'Não foi possível salvar o ajuste da foto.');
}

export function removeCover(): void {
  const c = ids();
  if (!c) return;
  trackWrite(deleteDoc(coverRef(c.groupId)), 'Não foi possível remover a foto do cartão.');
}
