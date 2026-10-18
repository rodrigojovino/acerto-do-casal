# Acerto do Casal

App de gastos compartilhados de um casal com acerto mensal. Cada um lança o que pagou; no fim do mês o app calcula quem deve quanto a quem. Exatamente 2 usuários. Substitui uma planilha.

Escopo completo: documento "Acerto do Casal — Escopo do MVP" (Claude Docs). Este arquivo resume o que o código precisa respeitar.

## Stack

- Ionic + Vue 3 + TypeScript (strict), Vite
- Capacitor (Android). appId: `io.github.rodrigojovino.acerto` · appName: `Acerto do Casal` · Android mínimo 8.0 (API 26)
- Firebase, projeto `acerto-do-casal`: Authentication (Google), Firestore com cache offline (`persistentLocalCache`), Cloud Storage, Cloud Functions, Cloud Messaging, Hosting (versão web, https://acerto-do-casal.web.app)
  - Regiões: Firestore e Functions em `southamerica-east1`; Storage em `us-east1` (bucket `acerto-do-casal.firebasestorage.app`, faixa gratuita).
  - Firestore com proteção contra exclusão ativada.
- Login Google: `@capacitor-firebase/authentication` com `skipNativeAuth` (o idToken nativo vai para o Firebase JS SDK); na web, popup com redirect de reserva. No aparelho o Auth usa `initializeAuth` + IndexedDB.
- Câmera e QR Code: plugin Capacitor com ML Kit
- Testes: Vitest (domínio, `npm test`) e emuladores do Firebase para regras e Functions (`npm run test:emulators`, projeto `demo-acerto`)
- Build: GitHub Actions gera o APK assinado e publica no Release (`release.yml`, tag `vX.Y.Z`). `ci.yml` roda os testes e compila um APK de debug a cada push. Instalação por download direto do GitHub.

## Comandos e cuidados do Firebase

- `npm run emulators` sobe Auth, Firestore, Functions e Storage locais; o app usa os emuladores em dev com `VITE_USE_EMULATORS=true`.
- Todo comando da CLI leva `--project acerto-do-casal` explícito. Existe outro projeto Firebase de trabalho na mesma conta: nunca executar comandos nele.
- Antes de um deploy que inclua Firestore ou Storage, confirmar que o banco e o bucket existem e em qual região: o `firebase deploy` cria o banco sozinho na região padrão (`nam5`) quando ele não existe, e a região não muda depois.
- Functions: as opções globais (região, `maxInstances`) ficam em `functions/src/options.ts`, importado antes de qualquer Function; com ESM, `setGlobalOptions` no corpo do `index.ts` roda tarde demais.
- Artifact Registry com limpeza de imagens após 1 dia (`functions:artifacts:setpolicy`).
- Regras do Firestore: `match /{document=**}` também casa com zero segmentos; para subcoleções use `match /{collection}/{document=**}`.
- Deve existir uma única cópia de `@firebase/app` em `node_modules` (o CI confere); duas cópias quebram o app com "Component auth has not been registered yet". Corrigir com `npm dedupe`.

## Convenções

- Identificadores no código em inglês; textos da interface e comentários em pt-BR.
- **Dinheiro sempre em centavos inteiros** (`number`, nunca float de reais). Formatação só na exibição (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).
- Datas como string `YYYY-MM-DD`; mês de competência como `YYYY-MM`. Fuso `America/Sao_Paulo`.
- Toda regra de cálculo vive em `src/domain/` como funções puras, com testes. Componentes não calculam saldo.
- Divisão na tela × banco: o banco guarda `payerSharePct` (parte de quem pagou); a tela mostra "eu / outro". Converter só com `splitForViewer` e `payerSharePctFromViewer` (`src/domain/split.ts`), que invertem quando o pagador é o outro. Texto de dívida por gasto só com `debtView` (`src/services/expenseView.ts`).
- Textos com o primeiro nome da outra pessoa ("Bia te deve", "Você deve para Bia"); nada de "Ela/Ele" nem crase que suponha gênero.
- Gravações no Firestore não são aguardadas na tela (offline, a promessa só termina ao sincronizar): usar `trackWrite` (`src/services/sync.ts`) e seguir. Nada de transação no app.
- Ionic mantém vivas as telas visitadas: cada tela fixa sua rota (`useRoute().name`, `params`) na criação. Ler a rota de forma reativa faz a tela reagir às rotas das outras e já quebrou a navegação.
- Áreas seguras: usar `--app-safe-top/-bottom/-left/-right` (`src/theme/variables.css`), nunca `env(safe-area-inset-*)` direto. No Android 15+ (edge-to-edge, obrigatório no Android 16) o `env()` pode vir zerado e a barra inferior já ficou atrás da navegação por 3 botões; o Capacitor injeta os valores reais (`SystemBars.insetsHandling: 'css'`).

## Repositório público: segurança

- Nenhum segredo no código: keystore, senhas e chaves de conta de serviço ficam nos Secrets do GitHub ou no Secret Manager do Firebase.
- A config web do Firebase e o `google-services.json` podem ser versionados; a proteção vem das regras do Firestore e do Storage.
- Nunca commitar dados reais do casal, nem em fixtures de teste.

## Regras de negócio

### Cálculo de um gasto

```
rateio        = totalCents - personalCents        // parte pessoal é sempre de quem pagou
outroDeve     = round(rateio * (100 - payerSharePct) / 100)   // dívida do não pagador com o pagador
```

- `payerSharePct` padrão 50 (vem de `group.defaultSplitPct`), editável por gasto.
- Arredondamento: `Math.round` no nível de cada gasto, em centavos.
- Saldo do mês = soma de `outroDeve` por direção; o resultado líquido diz quem paga quanto a quem.
- Exemplo de referência (usar como teste): Mercado 200,00 pago por A com 50,00 pessoal; Luz 300,00 por B; Internet 120,00 por A; Geladeira parcela 214,00 por B; Farmácia 80,00 por A; Padaria 36,00 por B; tudo 50/50 → A paga R$ 100,00 a B.

### Status do gasto

| status | conta no saldo | quando |
| --- | --- | --- |
| `confirmed` | sim | aprovado pelo outro membro, ou QR Code conferido pela SEFAZ com valor igual ao lançado |
| `pending_approval` | sim, destacado | todo gasto nasce assim (sem comprovante, com foto ou com QR) |
| `returned` | sim, destacado | recusado pelo outro; volta para quem lançou corrigir |
| `awaiting_confirmation` | não | recorrente gerado automaticamente, aguardando quem paga confirmar o valor |

- **Quem lança nunca grava `confirmed`.** Só confirmam: o outro membro (aprovação) e a Function de conferência do QR. As regras do Firestore garantem isso.
- **Sem comprovante:** nasce `pending_approval`; o outro aprova ou recusa (motivo opcional).
- **Foto:** nasce `pending_approval`. O outro só pode aprovar depois que a foto foi enviada (`receipt.photoUploaded: true`); antes disso, "Aprovar" fica bloqueado com o aviso "Foto ainda não enviada", e as regras também barram.
- **QR Code da NFC-e (qualquer estado):** vale como comprovante. A chave (44 dígitos, modelo 65, dígito verificador) é validada e dela saem UF, CNPJ do emitente e ano/mês; descrição e data podem vir pré-preenchidas, o valor é digitado. Nasce `pending_approval`, online ou offline.
  - **SP:** o gatilho da Function consulta a SEFAZ-SP e marca `confirmed` quando a nota é conferida e o valor lançado é igual ao da nota. Se a consulta falhar ou o valor divergir, continua `pending_approval` com o aviso, para o outro aprovar.
  - **Outros estados:** sem consulta online (`nfceStatus: 'unchecked'`); vai para a aprovação do outro, como uma foto. O Detalhe mostra "Nota de [UF]: conferência automática só para SP".
- **Anexar comprovante a um pendente:** só um QR conferido dispensa a aprovação; anexar foto mantém pendente.
- **Editar um gasto confirmado** o devolve a `pending_approval` (o gatilho reconfirma se o QR continuar conferindo). Trocar o QR zera a conferência (`nfceStatus: 'pending'`).
- Só quem lançou edita ou exclui o gasto. O outro só aprova ou recusa.

### Parcelados

- Informa total, número de parcelas e mês da primeira. Gera uma parcela por mês com a mesma divisão e parte pessoal proporcional.
- Valor por parcela = `floor(total / n)`; o resto dos centavos vai na primeira parcela.
- Parte pessoal por arredondamento acumulado: a parte pessoal acumulada até a parcela *i* é `floor(totalAcumulado_i * personal / total)`, e a da parcela é a diferença para a anterior. A soma bate exatamente com o pessoal informado e nenhuma parcela tem parte pessoal maior que o próprio valor (caso extremo testado: R$ 0,10 com R$ 0,09 pessoal em 10 parcelas). Não usar a regra floor + resto na parte pessoal: nesse caso daria R$ 0,09 pessoal numa parcela de R$ 0,01.
- O comprovante da compra vale para todas as parcelas.

### Recorrentes

- Valor fixo ou variável. Uma Cloud Function agendada diária cria o gasto no dia configurado como `awaiting_confirmation`.

### Mês (competência)

- Fecha só sem gastos `pending_approval`, `returned` ou `awaiting_confirmation`, e com o pagamento do acerto registrado (comprovante PIX ou "pago em dinheiro").
- Fecha só sem foto de comprovante pendente de envio (`receipt.type: 'photo'` com `photoUploaded: false`).
- Fechar e reabrir exigem conexão. Reabrir exige aprovação do outro membro.
- Gasto lançado com data de um mês fechado entra na competência do mês aberto, mantendo a `date` original.
- Gastos de mês fechado são imutáveis (garantir também nas regras do Firestore).

### Offline

Lançar, editar, anexar foto, aprovar e recusar funcionam offline. A consulta à SEFAZ de um QR lido offline acontece quando a conexão volta.

### Datas e navegação

- Data de um gasto: do mês de criação do grupo até o fim do mês seguinte ao atual (São Paulo). As regras validam o limite superior em UTC, o que as deixa no máximo um mês mais permissivas na virada, nunca mais restritivas.
- Navegação do Painel: do mês de criação do grupo até o mês seguinte ao atual.
- Competência: `resolveCompetence` (`src/domain/calendar.ts`): o mês da data; se fechado, o mês aberto atual; se também fechado, o próximo aberto.

### Vínculo do casal

- Só pelas Functions callable `createGroup`, `renewInvite` e `joinGroup` (`functions/src/group.ts`), cada uma numa transação. O app nunca cria nem altera `members`.
- Código de convite: 6 caracteres do alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sem 0/O, 1/I/L), exibido como `K7Q-4M2`, válido por 24 horas. Renovar invalida o anterior.
- `joinGroup` recusa: código inválido ou vencido, o próprio código, grupo com 2 membros, quem já está num grupo completo. Mais de 10 códigos errados em 1 hora bloqueiam o usuário até a janela vencer.
- Se os dois criaram grupo, quem digita o código do outro sai do próprio grupo (ainda só com ele), que é apagado.
- Vínculo e entrada exigem conexão.

## Modelo de dados (Firestore)

```
groups/{groupId}                 // criado e alterado em members/convite só pelas Functions
  members: [uid] | [uid, uid]    // 1 enquanto espera o outro; no máximo 2
  memberNames: { [uid]: string } // cada membro pode alterar só o próprio nome
  defaultSplitPct: 50            // membros podem alterar (inteiro 0..100)
  inviteCode: string | null      // sem hífen; null depois que o segundo entra
  inviteExpiresAt: Timestamp | null
  createdAt

memberships/{uid}                // só Functions escrevem; cada um lê o próprio
  groupId

invites/{code}                   // só Functions; app sem acesso
  groupId, createdBy, expiresAt

joinAttempts/{uid}               // só Functions; app sem acesso
  failures, windowStart

groups/{groupId}/months/{YYYY-MM}
  status: 'open' | 'closed'
  settlement?: { fromUid, toUid, amountCents, method: 'pix' | 'cash', receiptPath?, paidAt }
  reopenRequest?: { byUid, at, status: 'pending' | 'approved' | 'denied' }

groups/{groupId}/expenses/{expenseId}
  description, totalCents, personalCents, payerUid, payerSharePct
  date: 'YYYY-MM-DD', competence: 'YYYY-MM'
  receipt:
    { type: 'none' }
    | { type: 'photo', photoPath: 'groups/{g}/receipts/{id}.jpg', photoUploaded: bool }
    | { type: 'nfce', nfceKey (44 dígitos), nfceUrl? (só SP: URL canônica), nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked',
        nfceData?: { issuerName, totalCents, date }, nfceError? }
        // app grava 'pending' (SP) ou 'unchecked' (outros estados); ok/failed e nfceData: só a Function
  status: 'confirmed' | 'pending_approval' | 'returned' | 'awaiting_confirmation'
  approval?: { byUid, at }        // byUid 'nfce' = confirmado pela conferência da nota (só a Function grava)
  rejection?: { byUid, reason? (até 200), at }
  recurringId?, installment?: { seriesId, index, count }
  createdBy, createdAt, updatedAt

groups/{groupId}/recurring/{recurringId}
  description, kind: 'fixed' | 'variable', amountCents?, dayOfMonth, payerUid, payerSharePct, active
```

Fotos no Storage em `groups/{groupId}/receipts/{expenseId}.jpg`, comprimidas no aparelho antes do upload. As regras aceitam só membros do grupo, `image/jpeg` e menos de 5 MB.

Regras atuais (`firestore.rules` e `storage.rules`, testadas em `tests/emulators/`):
- `expenses`: só membros leem. Centavos inteiros, total > 0, pessoal ≤ total, pct inteiro 0..100, pagador membro, descrição 1..80, data até o fim do mês seguinte, competência coerente com a data e nunca em mês fechado.
- **Quem lança** (criar e editar): todos os campos e nenhum a mais, `createdBy` = quem cria, horários do servidor, sempre `status: 'pending_approval'`, sem `approval`/`rejection` (a edição apaga as anteriores). Comprovante: foto no caminho do próprio gasto (não enviada na criação); QR com chave de 44 dígitos e modelo 65: de SP só `'pending'` com a URL canônica da própria chave, de outros estados só `'unchecked'` sem URL; ou mantido sem mudança na edição. O dígito verificador é conferido no app e na Function (as regras não calculam o módulo 11). Exceção estreita: a fila de fotos pode só virar `receipt.photoUploaded` para `true`, sem mexer no status.
- **Outro membro**: só aprova (`pending_approval` → `confirmed`, `approval.byUid` = ele; com foto, só depois de enviada) ou recusa (`→ returned`, motivo opcional). Não toca em valores nem no comprovante.
- **Function `checkNfce`** (gatilho): consulta a SEFAZ quando o QR chega ao servidor; grava `nfceStatus`/`nfceData`; confirma com `approval.byUid: 'nfce'` só se o valor lançado for igual ao da nota. `resolveNfce` (callable) só pré-preenche o formulário.
- Exclusão: só quem lançou, nunca em mês fechado. `months`: só leitura (fechamento na Fase 6). Subcoleções sem regra própria (ex.: `recurring`) ficam fechadas.
- Storage: só quem lançou o gasto (tipo foto) envia/troca/apaga a foto, JPEG até 1 MB; membros leem. Cada regra faz uma única leitura no Firestore (por isso o app apaga a foto antes do documento). Exige a permissão do agente do Storage para ler o Firestore (papel "Firebase Rules Firestore Service Agent").
- `src/services/expenseData.ts` monta os documentos (gasto, edição, aprovação, recusa) como o app grava; os testes de regras usam as mesmas funções.

Comprovantes no app:
- Foto: câmera ou galeria (`@capacitor/camera`), comprimida no aparelho para JPEG < 500 KB (`src/domain/image.ts`) e guardada numa fila no IndexedDB (`src/services/photoQueue.ts`) até subir; só sobe depois que o gasto existe no servidor.
- QR: leitor do Google (ML Kit, só Android, sem permissão de câmera); lido no aparelho com o mesmo parser das Functions (`parseNfceQr` em `functions/src/nfce.ts`). Aceita QR de qualquer SEFAZ (`p=` das versões 2 e 3, `chNFe=` da versão 1, ou a chave no texto) e as variações da URL de SP (http/https, com ou sem www, `/qrcode` ou `ConsultaQRCode.aspx`). Para SP monta a URL canônica `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=…`; a rede só é acessada nela, nunca no endereço lido, e sem seguir redirecionamentos.

## Risco conhecido: NFC-e

O QR Code atual da NFC-e normalmente não traz o valor; é preciso consultar o portal da SEFAZ, que pode ter captcha. Só SP tem consulta automática; notas de outros estados valem como comprovante sem consulta e vão para aprovação. Plano B (SP, se a consulta falhar): o QR preenche data, emitente e chave; o valor é digitado e o QR continua valendo como comprovante.

Prova de conceito (Fase 1): viável com limitações, sem captcha; depende do HTML da página e não tem CORS, então a consulta roda numa Function. Confirmado na nuvem na Fase 4 (6 de 6 notas a partir de `southamerica-east1`). Detalhes em `scripts/sefaz-poc/PARECER.md`.

## Fases

1. [x] Fundação: scaffold, Firebase, domínio + testes, build no GitHub Actions, prova de conceito da SEFAZ
2. [x] Acesso: login Google e vínculo do casal por código
3. [x] Núcleo do acerto: lançamento, painel com saldo, offline
4. [x] Comprovantes e aprovação
5. [ ] Recorrentes e parcelados (Cloud Functions)
6. [ ] Fechamento, reabertura e histórico
7. [ ] Notificações, exportação Excel/PDF, versão web
   - Pendência herdada da Fase 4: limpar fotos órfãs no Storage (foto já enviada de um gasto que trocou para "Sem comprovante" ou para QR, ou excluído offline).
   - Pendência herdada da Fase 4 (prioridade baixa): reduzir o tamanho do APK (de ~6 MB para ~31,5 MB com a leitura de QR); avaliar o modelo de QR via Google Play Services em vez do embutido no APK.
8. [ ] Uso real em paralelo com a planilha por um mês

Fora do MVP: categorias com gráficos, importação da planilha.
