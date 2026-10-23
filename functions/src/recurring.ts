import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { monthOf, todayInSaoPaulo, type IsoDate } from '../../src/domain/calendar.js';
import {
  recurringExpenseData,
  recurringExpenseId,
  shouldGenerate,
  type Recurring,
} from '../../src/domain/recurrence.js';
import { variableRecurringSummary } from '../../src/domain/notifications.js';
import { sendNotices } from './notify.js';

if (getApps().length === 0) initializeApp();

export interface GenerationReport {
  created: number;
  skipped: number;
}

/** Meses fechados do grupo (a competência do gasto gerado nunca cai num deles). */
async function closedMonthsOf(groupRef: DocumentReference): Promise<Set<string>> {
  const closedSnap = await groupRef.collection('months').where('status', '==', 'closed').get();
  return new Set(closedSnap.docs.map((d) => d.id));
}

/**
 * Gera o gasto de um cadastro no mês de `today`, numa transação que confere
 * `lastGeneratedMonth` e cria o gasto com id fixo por mês: rodar de novo (ou
 * duas execuções ao mesmo tempo) nunca duplica, e um gasto excluído não volta.
 * `true` se criou o gasto agora.
 */
async function generateOne(
  db: Firestore,
  groupRef: DocumentReference,
  recurringRef: DocumentReference,
  today: IsoDate,
  closedMonths: ReadonlySet<string>,
): Promise<boolean> {
  const month = monthOf(today);
  const expenseRef = groupRef.collection('expenses').doc(recurringExpenseId(recurringRef.id, month));
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(recurringRef);
    const current = { id: fresh.id, ...fresh.data() } as Recurring;
    if (!fresh.exists || !shouldGenerate(current, today)) return false;
    const existing = await tx.get(expenseRef);
    tx.update(recurringRef, { lastGeneratedMonth: month });
    if (existing.exists) return false;
    tx.create(expenseRef, recurringExpenseData(current, today, closedMonths, FieldValue.serverTimestamp()));
    return true;
  });
}

/**
 * Gera os gastos recorrentes do mês de `today` (São Paulo) em todos os grupos.
 * Idempotente: cada geração é uma transação que confere `lastGeneratedMonth`
 * do cadastro e cria o gasto com id fixo por mês, então rodar de novo (ou duas
 * execuções ao mesmo tempo) nunca duplica, e um gasto excluído não volta.
 */
export async function generateRecurring(today: IsoDate, db: Firestore = getFirestore()): Promise<GenerationReport> {
  const report: GenerationReport = { created: 0, skipped: 0 };

  const groups = await db.collection('groups').get();
  for (const group of groups.docs) {
    const members = (group.get('members') as string[] | undefined) ?? [];
    if (members.length !== 2) continue;

    const recurring = await group.ref.collection('recurring').where('active', '==', true).get();
    if (recurring.empty) continue;

    const closedMonths = await closedMonthsOf(group.ref);
    /** Variáveis gerados agora, para o resumo de quem paga (um aviso por pessoa). */
    const variables: Array<{ payerUid: string; description: string }> = [];

    for (const doc of recurring.docs) {
      const rec = { id: doc.id, ...doc.data() } as Recurring;
      if (!shouldGenerate(rec, today) || !members.includes(rec.payerUid)) {
        report.skipped++;
        continue;
      }
      const created = await generateOne(db, group.ref, doc.ref, today, closedMonths);
      if (created) {
        report.created++;
        if (rec.kind === 'variable') variables.push({ payerUid: rec.payerUid, description: rec.description });
      } else report.skipped++;
    }

    if (variables.length > 0) {
      try {
        await sendNotices(group.id, variableRecurringSummary(variables));
      } catch (err) {
        // O aviso nunca impede a geração.
        logger.error('Resumo dos recorrentes não enviado', { groupId: group.id, err: String(err) });
      }
    }
  }
  return report;
}

/**
 * Gera na hora o gasto do mês atual de um cadastro que acabou de poder gerar:
 * variável cadastrado (não precisa de aprovação), fixo aprovado ou cadastro
 * reativado, se o mês atual estiver no período. Mesma transação da geração
 * diária (`generateOne`). A própria marca `lastGeneratedMonth` dispara o
 * gatilho de novo, mas aí `shouldGenerate` já é falso. Sem aviso: recorrente
 * gerado não avisa (o resumo dos variáveis é só da geração diária).
 */
export async function generateOnWrite(
  after: DocumentSnapshot,
  today: IsoDate,
  db: Firestore = getFirestore(),
): Promise<boolean> {
  if (!after.exists) return false;
  const rec = { id: after.id, ...after.data() } as Recurring;
  if (!shouldGenerate(rec, today)) return false;
  const groupRef = after.ref.parent.parent!;
  const members = ((await groupRef.get()).get('members') as string[] | undefined) ?? [];
  if (members.length !== 2 || !members.includes(rec.payerUid)) return false;
  return generateOne(db, groupRef, after.ref, today, await closedMonthsOf(groupRef));
}

/**
 * Data de hoje para o gatilho. No emulador, só a data fixada pelos testes em
 * `emulatorFixtures/clock` (sem ela, o gatilho não gera: os outros testes
 * semeiam cadastros e não esperam gastos do mês real).
 */
async function triggerToday(db: Firestore): Promise<IsoDate | null> {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return todayInSaoPaulo();
  const clock = await db.doc('emulatorFixtures/clock').get();
  return clock.exists ? (clock.get('today') as IsoDate) : null;
}

export const generateRecurringOnWrite = onDocumentWritten('groups/{groupId}/recurring/{recurringId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const db = getFirestore();
  const today = await triggerToday(db);
  if (!today) return;
  const created = await generateOnWrite(after, today, db);
  if (created) logger.info('recorrente gerado na hora', { recurringId: after.id });
});

/**
 * Todo dia às 6h (São Paulo). No dia 1 gera todos os recorrentes ativos do mês;
 * nos outros dias gera os cadastrados ou aprovados depois e recupera execuções
 * perdidas (nunca duplica).
 */
export const generateRecurringDaily = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'America/Sao_Paulo', timeoutSeconds: 300 },
  async () => {
    const today = todayInSaoPaulo();
    const report = await generateRecurring(today);
    logger.info('recorrentes gerados', { today, ...report });
  },
);
