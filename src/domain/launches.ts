/**
 * Lançamento guardado no aparelho até o servidor confirmar. Se o mês fechou
 * enquanto o gasto estava offline, as regras recusam a gravação na
 * sincronização e o Firestore apaga a cópia local: o app oferece relançar no
 * mês aberto com os mesmos dados (inclusive depois de fechar e reabrir o app).
 */

export type LaunchState = 'confirmed' | 'waiting' | 'rejected';

export interface LaunchCheck {
  /** O gasto existe no servidor; `null` = não deu para consultar (sem conexão ou erro). */
  onServer: boolean | null;
  /** O cache local ainda tem o gasto com gravação pendente (vai sincronizar). */
  pendingInCache: boolean;
}

/**
 * Confirmado: está no servidor (o registro local pode sair). Esperando: sem
 * como consultar, ou ainda pendente no cache. Recusado: o servidor não tem e
 * o cache já descartou a gravação (as regras recusaram).
 */
export function launchState({ onServer, pendingInCache }: LaunchCheck): LaunchState {
  if (onServer === true) return 'confirmed';
  if (onServer === null || pendingInCache) return 'waiting';
  return 'rejected';
}
