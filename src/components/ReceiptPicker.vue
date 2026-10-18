<template>
  <div class="field">
    <span id="comprovante" class="label">Comprovante</span>
    <div class="options" role="group" aria-labelledby="comprovante">
      <button type="button" class="option" :aria-pressed="modelValue.type === 'photo'" :disabled="busy" @click="choosePhoto">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        {{ modelValue.type === 'photo' ? 'Foto ✓' : 'Foto' }}
      </button>
      <button v-if="canScanQr" type="button" class="option" :aria-pressed="modelValue.type === 'nfce'" :disabled="busy" @click="scanQr">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z" /></svg>
        {{ modelValue.type === 'nfce' ? 'QR NFC-e ✓' : 'QR NFC-e' }}
      </button>
      <button type="button" class="option dashed" :aria-pressed="modelValue.type === 'none'" :disabled="busy" @click="clear">
        Sem<br />comprovante
      </button>
    </div>

    <div v-if="modelValue.type === 'photo'" class="preview">
      <img v-if="modelValue.previewUrl" :src="modelValue.previewUrl" alt="Foto do comprovante" class="thumb" />
      <span v-else class="thumb placeholder">Foto já anexada</span>
      <button type="button" class="link" :disabled="busy" @click="choosePhoto">Trocar foto</button>
    </div>
    <p v-else-if="modelValue.type === 'nfce'" class="hint strong">{{ modelValue.label }}</p>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p class="hint">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import { actionSheetController } from '@ionic/vue';
import { computed, ref } from 'vue';
import { PhotoError, pickReceiptPhoto, type PhotoSource } from '@/services/photo';
import { QrError, canScanQr, scanNfceQr, type ScannedNfce } from '@/services/nfce';

/** Estado da seção de comprovante no formulário. */
export type ReceiptState =
  | { type: 'none' }
  /** `data`: foto nova escolhida agora (ainda não guardada); sem ela, mantém a já anexada. */
  | { type: 'photo'; data?: Blob; previewUrl: string | null }
  | { type: 'nfce'; nfceKey: string; nfceUrl: string; label: string };

const props = defineProps<{ modelValue: ReceiptState; partnerName: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: ReceiptState];
  /** QR lido: o formulário consulta a nota e pré-preenche. */
  scanned: [value: ScannedNfce];
}>();

const busy = ref(false);
const error = ref<string | null>(null);

const note = computed(() => {
  switch (props.modelValue.type) {
    case 'photo':
      return `Com foto, ${props.partnerName} aprova depois de ver a foto. Sem conexão, a foto fica no aparelho e é enviada depois.`;
    case 'nfce':
      return `A nota é conferida na SEFAZ. Se o valor bater, o gasto é confirmado sem precisar da aprovação de ${props.partnerName}.`;
    default:
      return `Sem comprovante, o gasto fica pendente até ${props.partnerName} aprovar.`;
  }
});

async function choosePhoto(): Promise<void> {
  error.value = null;
  const sheet = await actionSheetController.create({
    header: 'Foto do comprovante',
    buttons: [
      { text: 'Tirar foto', data: 'camera' },
      { text: 'Escolher da galeria', data: 'gallery' },
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
  const { data } = await sheet.onDidDismiss<PhotoSource>();
  if (data !== 'camera' && data !== 'gallery') return;

  busy.value = true;
  try {
    const photo = await pickReceiptPhoto(data);
    if (!photo) return;
    emit('update:modelValue', { type: 'photo', data: photo.data, previewUrl: URL.createObjectURL(photo.data) });
  } catch (err) {
    error.value = err instanceof PhotoError ? err.message : 'Não foi possível usar esta foto.';
  } finally {
    busy.value = false;
  }
}

async function scanQr(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const scanned = await scanNfceQr();
    if (!scanned) return;
    const [y, m] = scanned.yearMonth.split('-');
    emit('update:modelValue', {
      type: 'nfce',
      nfceKey: scanned.key,
      nfceUrl: scanned.url,
      label: `Nota fiscal de ${m}/${y} lida`,
    });
    emit('scanned', scanned);
  } catch (err) {
    error.value = err instanceof QrError ? err.message : 'Não foi possível ler o QR Code.';
  } finally {
    busy.value = false;
  }
}

function clear(): void {
  error.value = null;
  emit('update:modelValue', { type: 'none' });
}

defineExpose({ scanQr });
</script>

<style scoped>
.options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  grid-auto-flow: column;
  gap: 6px;
}

.option {
  min-height: 64px;
  border-radius: var(--app-radius-control);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: #3f3f3b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}

.option.dashed {
  border-style: dashed;
  border-color: #a9a8a2;
}

.option[aria-pressed='true'] {
  border: 2px solid var(--app-accent);
  background: #e3eafa;
  color: var(--app-accent-dark);
}

.option:disabled {
  opacity: 0.6;
  cursor: default;
}

.option:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.thumb {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--app-border);
}

.thumb.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 10px;
  color: var(--app-muted);
  background: var(--app-subtle);
}

.strong {
  font-weight: 700;
  color: var(--app-text);
}
</style>
