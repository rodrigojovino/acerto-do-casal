import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { fetchCnpjName, isValidCnpj, parseCnpjResponse, type CnpjName } from './cnpj.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * Respostas fictícias no emulador (sem rede): CNPJs inventados, com dígitos
 * verificadores válidos, no formato da BrasilAPI. Os demais: não encontrado.
 */
const EMULATOR_RESPONSES: Record<string, unknown> = {
  '11222333000181': { nome_fantasia: 'Mercado Teste', razao_social: 'MERCADO TESTE LTDA' },
  '11444777000161': { nome_fantasia: '', razao_social: 'FARMACIA EXEMPLO LTDA' },
};

const inEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * Nome do emitente pelo CNPJ, para preencher a descrição de notas sem
 * consulta à SEFAZ. Só para quem faz parte de um grupo. Usa o cache
 * `cnpjCache/{cnpj}` (só as Functions acessam) antes da BrasilAPI; falha ou
 * CNPJ não encontrado devolve `name: null` (a descrição fica com o CNPJ).
 */
export const lookupCnpj = onCall({ timeoutSeconds: 20 }, async (request): Promise<{ name: string | null }> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  const cnpj = typeof request.data?.cnpj === 'string' ? request.data.cnpj.replace(/\D/g, '') : '';
  if (!isValidCnpj(cnpj)) throw new HttpsError('invalid-argument', 'CNPJ inválido.');

  const membership = await db.doc(`memberships/${request.auth.uid}`).get();
  if (!membership.exists) throw new HttpsError('permission-denied', 'Você ainda não faz parte de um grupo.');

  const cacheRef = db.doc(`cnpjCache/${cnpj}`);
  const cached = await cacheRef.get();
  if (cached.exists) return { name: (cached.get('name') as string | undefined) ?? null };

  const found: CnpjName | null = inEmulator()
    ? parseCnpjResponse(EMULATOR_RESPONSES[cnpj] ?? null)
    : await fetchCnpjName(cnpj);
  // Só guarda o que achou: falha ou ausência pode ser tentada de novo depois.
  if (found) await cacheRef.set({ ...found, fetchedAt: FieldValue.serverTimestamp() });
  return { name: found?.name ?? null };
});
