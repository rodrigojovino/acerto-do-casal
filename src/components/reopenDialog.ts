import { alertController } from '@ionic/vue';
import { monthName } from '@/domain/calendar';
import type { Competence } from '@/domain/settlement';

/**
 * Tela do pedido de reabertura: motivo obrigatório e o aviso de que o outro
 * membro precisa aprovar. Devolve o motivo, ou `null` se a pessoa desistir.
 */
export async function askReopenReason(month: Competence, partnerName: string): Promise<string | null> {
  const help = `Reabrir exige a aprovação de ${partnerName}. Os pagamentos já feitos continuam valendo.`;
  const alert = await alertController.create({
    header: `Pedir reabertura de ${monthName(month)}`,
    message: help,
    inputs: [{ name: 'reason', type: 'textarea', placeholder: 'Motivo (ex.: faltou lançar a farmácia)', attributes: { maxlength: 200 } }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Enviar pedido',
        role: 'confirm',
        handler: (values: { reason?: string }) => {
          if (values.reason?.trim()) return true;
          alert.message = `Informe o motivo. ${help}`;
          return false;
        },
      },
    ],
  });
  await alert.present();
  const { role, data } = await alert.onDidDismiss<{ values: { reason?: string } }>();
  const reason = data?.values?.reason?.trim();
  return role === 'confirm' && reason ? reason : null;
}
