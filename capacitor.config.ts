import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.rodrigojovino.acerto',
  appName: 'Acerto do Casal',
  webDir: 'dist',
  plugins: {
    // Android 15+ desenha o app atrás das barras do sistema (edge-to-edge).
    // 'css' injeta --safe-area-inset-* com os valores reais (usados em theme/variables.css).
    SystemBars: {
      insetsHandling: 'css',
      // index.html usa viewport-fit=cover; avisar antes evita um salto no layout ao abrir.
      initialViewportFitValueHint: 'cover',
      // Ícones escuros sobre o fundo claro do app, mesmo com o celular em modo escuro.
      style: 'LIGHT',
    },
    FirebaseAuthentication: {
      // O login nativo só obtém a credencial Google; quem autentica é o Firebase JS SDK.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
