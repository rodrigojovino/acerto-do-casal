import type { SessionStatus } from '@/services/session';

/**
 * Telas do app e quem pode abrir cada uma: a mesma tabela monta as rotas
 * (`src/router/index.ts`) e decide a guarda. Uma tela nova entra aqui com o
 * caminho e o acesso; sem isso não há rota (o typecheck recusa o componente
 * sem nome) nem permissão. O teste `access.spec.ts` percorre todas pela guarda.
 */
export const SCREENS = [
  { name: 'entrar', path: '/entrar', access: ['signedOut'] },
  { name: 'vinculo', path: '/vinculo', access: ['noGroup', 'waitingPartner'] },
  { name: 'painel', path: '/painel', access: ['linked'] },
  { name: 'pendencias', path: '/pendencias', access: ['linked'] },
  { name: 'historico', path: '/historico', access: ['linked'] },
  { name: 'mes', path: '/historico/:mes(\\d{4}-\\d{2})', access: ['linked'] },
  { name: 'fechar', path: '/fechar/:mes(\\d{4}-\\d{2})', access: ['linked'] },
  { name: 'ajustes', path: '/ajustes', access: ['linked'] },
  { name: 'recorrentes', path: '/ajustes/recorrentes', access: ['linked'] },
  { name: 'avisos', path: '/ajustes/avisos', access: ['linked'] },
  { name: 'categorias', path: '/ajustes/categorias', access: ['linked'] },
  { name: 'recorrente-novo', path: '/ajustes/recorrentes/nova', access: ['linked'] },
  { name: 'recorrente', path: '/ajustes/recorrentes/:id', access: ['linked'] },
  { name: 'gasto-novo', path: '/gasto/novo', access: ['linked'] },
  { name: 'gasto', path: '/gasto/:id', access: ['linked'] },
  { name: 'gasto-editar', path: '/gasto/:id/editar', access: ['linked'] },
] as const satisfies ReadonlyArray<{ name: string; path: string; access: readonly SessionStatus[] }>;

export type RouteName = (typeof SCREENS)[number]['name'];

/** Tela inicial de cada estado da sessão (para onde a guarda manda). */
export const HOME_FOR: Record<SessionStatus, RouteName> = {
  signedOut: 'entrar',
  noGroup: 'vinculo',
  waitingPartner: 'vinculo',
  linked: 'painel',
};

const accessByName = new Map<string, readonly SessionStatus[]>(SCREENS.map((s) => [s.name, s.access]));

export function canOpen(status: SessionStatus, name: unknown): boolean {
  return accessByName.get(String(name))?.includes(status) ?? false;
}

/** Guarda: `null` se a tela pode abrir no estado atual; senão, a tela inicial do estado. */
export function guardTarget(status: SessionStatus, name: unknown): RouteName | null {
  return canOpen(status, name) ? null : HOME_FOR[status];
}
