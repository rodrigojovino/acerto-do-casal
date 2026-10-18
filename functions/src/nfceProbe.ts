import './options.js';
import { timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { NfceError, fetchNfce } from './nfce.js';

/**
 * TEMPORÁRIA (Fase 4, tarefa 1): testa se a consulta à SEFAZ-SP funciona a
 * partir da nuvem (IP do Google em southamerica-east1). Protegida por token no
 * Secret Manager. Não registra as URLs. Apagar depois do teste.
 */
const probeToken = defineSecret('NFCE_PROBE_TOKEN');

function authorized(header: string | undefined, expected: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const nfceProbe = onRequest({ secrets: [probeToken], maxInstances: 1, timeoutSeconds: 120 }, async (req, res) => {
  if (req.method !== 'POST' || !authorized(req.get('authorization'), probeToken.value())) {
    res.status(404).send('Not found');
    return;
  }
  const urls: unknown = req.body?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 5 || !urls.every((u) => typeof u === 'string')) {
    res.status(400).json({ error: 'Envie { "urls": [ ... ] } com 1 a 5 URLs.' });
    return;
  }

  const results = [];
  for (const [i, url] of (urls as string[]).entries()) {
    try {
      const { result, timing } = await fetchNfce(url);
      results.push({
        nota: i + 1,
        ok: true,
        http: timing.status,
        ms: timing.ms,
        emitente: result.issuerName,
        totalCents: result.totalCents,
        data: result.date,
        conferidoComChave: true,
      });
    } catch (err) {
      results.push({
        nota: i + 1,
        ok: false,
        motivo: err instanceof NfceError ? err.reason : 'erro inesperado',
        mensagem: err instanceof Error ? err.message : String(err),
      });
    }
  }
  res.json({ regiao: process.env.FUNCTION_REGION ?? 'southamerica-east1', results });
});
