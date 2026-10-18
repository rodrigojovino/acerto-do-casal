import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { monthOf, todayInSaoPaulo, type IsoDate } from '../../src/domain/calendar.js';
import {
  recurringExpenseData,
  recurringExpenseId,
  shouldGenerate,
  type Recurring,
} from '../../src/domain/recurrence.js';

if (getApps().length === 0) initializeApp();

export interface GenerationReport {
  created: number;
  skipped: number;
}

/**
 * Gera os gastos recorrentes do mês de `today` (São Paulo) em todos os grupos.
 * Idempotente: cada geração é uma transação que confere `lastGeneratedMonth`
 * do cadastro e cria o gasto com id fixo por mês, então rodar de novo (ou duas
 * execuções ao mesmo tempo) nunca duplica, e um gasto excluído não volta.
 */
export async function generateRecurring(today: IsoDate, db: Firestore = getFirestore()): Promise<GenerationReport> {
  const month = monthOf(today);
  const report: GenerationReport = { created: 0, skipped: 0 };

  const groups = await db.collection('groups').get();
  for (const group of groups.docs) {
    const members = (group.get('members') as string[] | undefined) ?? [];
    if (members.length !== 2) continue;

    const recurring = await group.ref.collection('recurring').where('active', '==', true).get();
    if (recurring.empty) continue;

    const closedSnap = await group.ref.collection('months').where('status', '==', 'closed').get();
    const closedMonths = new Set(closedSnap.docs.map((d) => d.id));

    for (const doc of recurring.docs) {
      const rec = { id: doc.id, ...doc.data() } as Recurring;
      if (!shouldGenerate(rec, today) || !members.includes(rec.payerUid)) {
        report.skipped++;
        continue;
      }
      const expenseRef = group.ref.collection('expenses').doc(recurringExpenseId(rec.id, month));
      const created = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const current = { id: fresh.id, ...fresh.data() } as Recurring;
        if (!fresh.exists || !shouldGenerate(current, today)) return false;
        const existing = await tx.get(expenseRef);
        tx.update(doc.ref, { lastGeneratedMonth: month });
        if (existing.exists) return false;
        tx.create(expenseRef, recurringExpenseData(current, today, closedMonths, FieldValue.serverTimestamp()));
        return true;
      });
      if (created) report.created++;
      else report.skipped++;
    }
  }
  return report;
}

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
