# Bloco E: configurações nos consoles

Passo a passo das duas configurações do bloco E (manutenção) que são feitas à mão, fora do código: restringir as chaves de API do Firebase e proteger as tags `v*` no GitHub. Projeto `acerto-do-casal` (nunca o projeto de trabalho).

## 1. Restringir as chaves de API do Firebase

A config web e o `google-services.json` são públicos por natureza; a proteção dos dados vem das regras do Firestore e do Storage. A restrição das chaves limita o uso delas a este app e às APIs que ele usa (cota e abuso). Ela não substitui as regras: o cabeçalho Referer pode ser forjado.

### Quem usa cada chave

| chave | onde está | quem usa |
| --- | --- | --- |
| **Browser key** (termina em `mVR0`) | `.env` / variáveis do GitHub (`VITE_FIREBASE_API_KEY`) | Firebase JS SDK: login (Auth), Firestore e Storage, **na web e dentro do app Android** (WebView com origem `https://localhost`) |
| **Android key** (termina em `Ja4A`) | `android/app/google-services.json` | SDKs nativos: avisos (FCM, com Firebase Installations) e o Firebase Auth nativo, que o plugin de login (`@capacitor-firebase/authentication`) inicializa mesmo com `skipNativeAuth` |

As Functions callable (`lookupCnpj`, `closeMonth` etc.) não usam chave de API. O login Google em si usa o cliente OAuth; a chave Android é usada pelo Firebase Auth nativo (Identity Toolkit e Token Service).

**Aviso de "uso ativo" no console:** ao restringir as APIs de uma chave, o console avisa quando uma API que vai ficar de fora teve uso recente com aquela chave. Isso indica que o app está usando essa API: não confirme sem revisar. Mantenha a API na lista (ou entenda antes de onde vem o uso). Foi esse aviso que mostrou que a Android key também usa a Identity Toolkit, que faltava na primeira versão deste guia.

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
- Restrição de API (**Restringir chave**), 4 APIs:
  - Firebase Installations API
  - FCM Registration API
  - Identity Toolkit API
  - Token Service API

O APK de debug do CI tem outra assinatura e, com esta restrição, não recebe avisos. Não é usado no dia a dia; se precisar, acrescente o SHA-1 dele na mesma chave.

### Passo a passo

1. Abra o [Google Cloud Console › APIs e serviços › Credenciais](https://console.cloud.google.com/apis/credentials?project=acerto-do-casal) e **confira no topo que o projeto é `acerto-do-casal`**.
2. Em "Chaves de API", identifique as duas pelo final (botão "Mostrar chave"): `…mVR0` (Browser key, criada pelo Firebase) e `…Ja4A` (Android key).
3. **Uma chave de cada vez, começando pela Android key** (os avisos e o Firebase Auth nativo dependem dela):
   1. Clique no nome da chave.
   2. Em "Restrições do aplicativo", escolha o tipo da lista acima e preencha (para Android: "Adicionar", pacote e SHA-1).
   3. Em "Restrições da API", escolha "Restringir chave" e marque só as APIs da lista. Se o console avisar "uso ativo" de uma API que vai ficar de fora, pare e revise (veja o aviso acima) antes de salvar.
   4. Salve. A mudança leva até 5 minutos para valer.
4. Teste a Android key no celular: saia da conta e entre de novo com o Google (o login usa o Auth nativo e o aparelho registra o token de novo), depois peça para a outra pessoa lançar um gasto e veja se o aviso chega.
5. Repita o passo 3 para a Browser key e teste:
   - no celular: sair e entrar de novo com o Google, lançar um gasto com foto, abrir o Detalhe com a foto;
   - na web (https://acerto-do-casal.web.app): entrar com o Google (popup) e abrir o Painel.
6. Se algo parar de funcionar (erro "API key not valid", "requests from this referer are blocked" ou login que não completa), volte a restrição de aplicativo daquela chave para "Nenhuma" e salve; me mande o erro que eu identifico o que faltou.

## 2. Proteger as tags `v*` no GitHub

A tag `vX.Y.Z` dispara o `release.yml`, que gera e publica o APK assinado. A proteção garante que só o dono (admin) cria e apaga tags de versão, e que ninguém, nem o dono, altera (move para outro commit) uma tag existente. O `release.yml` não cria tags (só publica o Release de uma tag existente), então não precisa de exceção.

São **dois rulesets**, porque a exceção do dono (bypass) vale para todas as regras do mesmo ruleset: num só, o dono também conseguiria mover uma tag.

### Passo a passo

1. No repositório `rodrigojovino/acerto-do-casal`: **Settings › Rules › Rulesets › New ruleset › New tag ruleset**.
2. **Ruleset 1: "Criar e apagar tags de versão"** (só o admin)
   - Ruleset name: `Criar e apagar tags de versão`
   - Enforcement status: **Active**
   - Bypass list: **Add bypass › Repository admin**, com "Always allow"
   - Target tags: **Add target › Include by pattern** › `v*`
   - Rules: marque **Restrict creations** e **Restrict deletions**
   - **Create**
3. **Ruleset 2: "Tags de versão imutáveis"** (ninguém altera)
   - Ruleset name: `Tags de versão imutáveis`
   - Enforcement status: **Active**
   - Bypass list: **vazia** (ninguém)
   - Target tags: **Include by pattern** › `v*`
   - Rules: marque só **Restrict updates**
   - **Create**
4. Confira em Settings › Rules › Rulesets que os dois aparecem como **Active** com o alvo `v*`.

Na próxima versão (v0.7.5 ou seguinte), a criação e o envio da tag continuam como sempre; se o GitHub recusar o push da tag, me avise antes de mudar qualquer ruleset.

## 3. Backups agendados do Firestore

O banco `(default)` (`southamerica-east1`) não tem nenhum agendamento de backup hoje (conferido com `firestore:backups:schedules:list`). A proteção contra exclusão impede apagar o banco, mas não protege contra dados apagados ou estragados por engano.

### Recomendação: diário, com retenção de 14 dias

- Cada banco aceita um agendamento diário e um semanal; a retenção vai até 14 semanas. O horário do backup não é escolhido (o Google define).
- O banco é pequeno: o custo do armazenamento dos backups fica em centavos por mês (plano Blaze, que o projeto já usa por causa das Functions). Restaurar é cobrado pelo tamanho do backup.
- Diário com 14 dias perde no máximo um dia de lançamentos e cobre um erro percebido até duas semanas depois. O semanal com 8 semanas cobre mais tempo, mas pode perder até uma semana. Se quiser os dois, dá para ter ambos ao mesmo tempo.
- O backup é só do Firestore. As fotos ficam no Storage, que guarda arquivos apagados por 7 dias (soft delete, já ativo no bucket).

### Ativar (comando, com sua confirmação)

Eu executo, com o projeto explícito:

```
firebase firestore:backups:schedules:create --database "(default)" --recurrence DAILY --retention 14d --project acerto-do-casal
```

Semanal (se preferir, ou além do diário):

```
firebase firestore:backups:schedules:create --database "(default)" --recurrence WEEKLY --day-of-week SUNDAY --retention 8w --project acerto-do-casal
```

Conferir: `firebase firestore:backups:schedules:list --database "(default)" --project acerto-do-casal`. O primeiro backup aparece em até 24 horas: `firebase firestore:backups:list --project acerto-do-casal`.

### Ativar pelo console (alternativa)

1. [Console do Google Cloud › Firestore › Recuperação de desastres](https://console.cloud.google.com/firestore/databases/-default-/disaster-recovery?project=acerto-do-casal), conferindo que o projeto é `acerto-do-casal` e o banco é `(default)`.
2. "Criar agendamento de backup" › Diário › retenção de 14 dias › Criar.
3. A lista de backups aparece na mesma página depois da primeira execução.

### Restaurar, se precisar

Um backup **nunca sobrescreve** o banco em uso: a restauração cria um banco novo, na mesma região, com os dados daquele dia. O app continua no `(default)` durante todo o processo.

1. Listar os backups e escolher o do dia anterior ao problema:
   `firebase firestore:backups:list --project acerto-do-casal`
2. Restaurar num banco novo (o nome indica a data):
   `firebase firestore:databases:restore --database restauracao-AAAAMMDD --backup "projects/acerto-do-casal/locations/southamerica-east1/backups/ID_DO_BACKUP" --project acerto-do-casal`
3. Conferir os dados no console (Firestore › escolher o banco `restauracao-AAAAMMDD`).
4. Trazer de volta só o que se perdeu: eu escrevo um script de cópia do banco restaurado para o `(default)` (simulação primeiro, com contagens, e gravação só com sua confirmação), porque copiar tudo por cima desfaria o que foi lançado depois do backup.
5. Apagar o banco de restauração depois, para não pagar o armazenamento dele:
   `firebase firestore:databases:delete restauracao-AAAAMMDD --project acerto-do-casal`

Último recurso, se o `(default)` inteiro se perdesse: apontar o app para o banco restaurado (o id do banco na configuração do Firebase do app e das Functions, e as regras e índices publicados nele). Exige uma versão nova do app; antes disso, o caminho é sempre o passo 4.

Comandos de backup e de restauração, como os de deploy, só com sua confirmação explícita.
