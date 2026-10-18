import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Testes que precisam dos emuladores (regras e Functions).
// Rodar com `npm run test:emulators`, que sobe os emuladores antes.
export default defineConfig({
  resolve: {
    // Mesmo atalho do app (vite.config.ts): os testes de regras importam src/services/expenseData.ts.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/emulators/**/*.spec.ts'],
    // Os arquivos compartilham o mesmo emulador: um de cada vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
