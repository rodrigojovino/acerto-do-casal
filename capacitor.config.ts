import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.rodrigojovino.acerto',
  appName: 'Acerto do Casal',
  webDir: 'dist',
  plugins: {
    FirebaseAuthentication: {
      // O login nativo só obtém a credencial Google; quem autentica é o Firebase JS SDK.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
