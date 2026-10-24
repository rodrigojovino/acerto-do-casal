import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import type { SessionStatus } from '@/services/session';
import { HOME_FOR, SCREENS, guardTarget } from './access';

// Percorre todas as telas do app por um roteador real, montado com a mesma
// tabela e a mesma guarda do app: uma tela nova sem permissão (o bug da
// v0.8.0: Ajustes › Categorias voltava para o Painel) quebra aqui, no CI.

const STATUSES: SessionStatus[] = ['signedOut', 'noGroup', 'waitingPartner', 'linked'];
const stub = { render: () => null };

function appRouter(getStatus: () => SessionStatus) {
  const routes: RouteRecordRaw[] = [
    { path: '/', redirect: '/painel' },
    ...SCREENS.map((s) => ({ path: s.path, name: s.name, component: stub })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach((to) => {
    const target = guardTarget(getStatus(), to.name);
    return target ? { name: target, replace: true } : true;
  });
  return router;
}

/** Caminho concreto de uma tela (parâmetros preenchidos). */
const concrete = (path: string) => path.replace(/:mes\([^)]*\)/, '2026-10').replace(/:id/g, 'abc123');

describe('guarda de rota', () => {
  it('toda tela pode ser aberta em pelo menos um estado da sessão', () => {
    for (const s of SCREENS) expect(s.access.length, s.name).toBeGreaterThan(0);
  });

  it('a tela inicial de cada estado é permitida nele', () => {
    for (const st of STATUSES) expect(guardTarget(st, HOME_FOR[st]), st).toBeNull();
  });

  for (const st of STATUSES) {
    it(`${st}: cada tela abre se permitida; senão vai para ${HOME_FOR[st]}`, async () => {
      const router = appRouter(() => st);
      for (const s of SCREENS) {
        await router.push(concrete(s.path));
        const expected = (s.access as readonly SessionStatus[]).includes(st) ? s.name : HOME_FOR[st];
        expect(router.currentRoute.value.name, `${st} → ${s.path}`).toBe(expected);
      }
    });
  }

  it('o casal vinculado abre todas as telas do app (inclusive Ajustes › Categorias)', async () => {
    const router = appRouter(() => 'linked');
    const linked = SCREENS.filter((s) => (s.access as readonly SessionStatus[]).includes('linked'));
    expect(linked.map((s) => s.name)).toContain('categorias');
    for (const s of linked) {
      await router.push(concrete(s.path));
      expect(router.currentRoute.value.name, s.path).toBe(s.name);
    }
  });

  it('caminho desconhecido volta para a tela inicial', async () => {
    const router = appRouter(() => 'linked');
    await router.push('/nao-existe');
    expect(router.currentRoute.value.name).toBe('painel');
  });
});

describe('navegação por nome no código', () => {
  // Todo `{ name: '...' }` usado em router-link (:to), push e replace aponta para uma tela da tabela.
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.(vue|ts)$/.test(d.name) && !d.name.endsWith('.spec.ts') ? [join(dir, d.name)] : []));
  const used = new Set<string>();
  for (const f of files('src')) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?::to="|push\(|replace\()\s*\{\s*name:\s*'([^']+)'/g)) used.add(m[1]);
  }

  it('acha as navegações (o teste não está vazio)', () => {
    expect(used.size).toBeGreaterThan(5);
    expect(used).toContain('categorias');
  });

  it('todas apontam para telas existentes', () => {
    const names = new Set<string>(SCREENS.map((s) => s.name));
    expect([...used].filter((n) => !names.has(n))).toEqual([]);
  });
});
