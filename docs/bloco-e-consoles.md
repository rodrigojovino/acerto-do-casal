# Bloco E: configurações nos consoles

Passo a passo das duas configurações do bloco E (manutenção) que são feitas à mão, fora do código: restringir as chaves de API do Firebase e proteger as tags `v*` no GitHub. Projeto `acerto-do-casal` (nunca o projeto de trabalho).

## 1. Restringir as chaves de API do Firebase

A config web e o `google-services.json` são públicos por natureza; a proteção dos dados vem das regras do Firestore e do Storage. A restrição das chaves limita o uso delas a este app e às APIs que ele usa (cota e abuso). Ela não substitui as regras: o cabeçalho Referer pode ser forjado.

### Quem usa cada chave

| chave | onde está | quem usa |
| --- | --- | --- |
| **Browser key** (termina em `mVR0`) | `.env` / variáveis do GitHub (`VITE_FIREBASE_API_KEY`) | Firebase JS SDK: login (Auth), Firestore e Storage, **na web e dentro do app Android** (WebView com origem `https://localhost`) |
| **Android key** (termina em `Ja4A`) | `android/app/google-services.json` | SDKs nativos: avisos (FCM, com Firebase Installations) |

As Functions callable (`lookupCnpj`, `closeMonth` etc.) não usam chave de API. O login Google no Android usa o cliente OAuth, não a chave.

### Lista exata

**Browser key** (`mVR0`)
- Restrição de aplicativo: **Sites (referenciadores HTTP)**
  - `https://acerto-do-casal.web.app/*`
  - `https://acerto-do-casal.firebaseapp.com/*` (domínio do login por popup/redirect)
  - `https://localhost/*` (o app Android: o WebView do Capacitor roda em `https://localhost`)
  - Opcional, só se for usar o app em desenvolvimento contra a produção: `http://localhost:5173/*`. Com os emuladores (`VITE_USE_EMULATORS=true`) não precisa.
- Restrição de API (**Restringir chave**), 4 APIs:
  - Identity Toolkit API
  - Token Service API
  - Cloud Firestore API
  - Cloud Storage for Firebase API

**Android key** (`Ja4A`)
- Restrição de aplicativo: **Apps Android**
  - Nome do pacote: `io.github.rodrigojovino.acerto`
  - Impressão digital SHA-1: `44:13:82:B3:F0:5F:5B:74:41:CC:1A:20:A8:30:2F:95:16:03:71:D2` (a da assinatura do APK publicado, conferida no v0.7.4; é a mesma do `google-services.json`)
- Restrição de API (**Restringir chave**), 2 APIs:
  - Firebase Installations API
  - FCM Registration API

O APK de debug do CI tem outra assinatura e, com esta restrição, não recebe avisos. Não é usado no dia a dia; se precisar, acrescente o SHA-1 dele na mesma chave.

### Passo a passo

1. Abra o [Google Cloud Console › APIs e serviços › Credenciais](https://console.cloud.google.com/apis/credentials?project=acerto-do-casal) e **confira no topo que o projeto é `acerto-do-casal`**.
2. Em "Chaves de API", identifique as duas pelo final (botão "Mostrar chave"): `…mVR0` (Browser key, criada pelo Firebase) e `…Ja4A` (Android key).
3. **Uma chave de cada vez, começando pela Android key** (só os avisos dependem dela):
   1. Clique no nome da chave.
   2. Em "Restrições do aplicativo", escolha o tipo da lista acima e preencha (para Android: "Adicionar", pacote e SHA-1).
   3. Em "Restrições da API", escolha "Restringir chave" e marque só as APIs da lista.
   4. Salve. A mudança leva até 5 minutos para valer.
4. Teste a Android key no celular: saia da conta e entre de novo (o aparelho registra o token de novo), depois peça para a outra pessoa lançar um gasto e veja se o aviso chega.
5. Repita o passo 3 para a Browser key e teste:
   - no celular: sair e entrar de novo com o Google, lançar um gasto com foto, abrir o Detalhe com a foto;
   - na web (https://acerto-do-casal.web.app): entrar com o Google (popup) e abrir o Painel.
6. Se algo parar de funcionar (erro "API key not valid", "requests from this referer are blocked" ou login que não completa), volte a restrição de aplicativo daquela chave para "Nenhuma" e salve; me mande o erro que eu identifico o que faltou.

## 2. Proteger as tags `v*` no GitHub

A tag `vX.Y.Z` dispara o `release.yml`, que gera e publica o APK assinado. A proteção garante que só o dono cria tags de versão e que ninguém (nem o dono) move ou apaga uma tag publicada. O `release.yml` não cria tags (só publica o Release de uma tag existente), então não precisa de exceção.

São **dois rulesets**, porque a exceção do dono (bypass) vale para todas as regras do mesmo ruleset: num só, o dono também conseguiria mover e apagar.

### Passo a passo

1. No repositório `rodrigojovino/acerto-do-casal`: **Settings › Rules › Rulesets › New ruleset › New tag ruleset**.
2. **Ruleset 1: "Criar tags de versão"**
   - Ruleset name: `Criar tags de versão`
   - Enforcement status: **Active**
   - Bypass list: **Add bypass › Repository admin**, com "Always allow"
   - Target tags: **Add target › Include by pattern** › `v*`
   - Rules: marque só **Restrict creations**
   - **Create**
3. **Ruleset 2: "Tags de versão imutáveis"**
   - Ruleset name: `Tags de versão imutáveis`
   - Enforcement status: **Active**
   - Bypass list: **vazia** (ninguém)
   - Target tags: **Include by pattern** › `v*`
   - Rules: marque **Restrict updates** e **Restrict deletions**
   - **Create**
4. Confira em Settings › Rules › Rulesets que os dois aparecem como **Active** com o alvo `v*`.

Na próxima versão (v0.7.5 ou seguinte), a criação e o envio da tag continuam como sempre; se o GitHub recusar o push da tag, me avise antes de mudar qualquer ruleset.
