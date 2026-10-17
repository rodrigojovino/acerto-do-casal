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
| `confirmed` | sim | tem comprovante, ou foi aprovado |
| `pending_approval` | sim, destacado | lançado sem comprovante |
| `returned` | sim, destacado | recusado pelo outro; volta para quem lançou corrigir |
| `awaiting_confirmation` | não | recorrente gerado automaticamente, aguardando quem paga confirmar o valor |

- Comprovante = foto ou QR Code da NFC-e. Anexar comprovante a um gasto pendente o torna `confirmed` sem aprovação.
- Só quem lançou edita ou exclui o gasto. O outro só aprova ou recusa (motivo opcional).

### Parcelados

- Informa total, número de parcelas e mês da primeira. Gera uma parcela por mês com a mesma divisão e parte pessoal proporcional.
- Valor por parcela = `floor(total / n)`; o resto dos centavos vai na primeira parcela.
- Parte pessoal por arredondamento acumulado: a parte pessoal acumulada até a parcela *i* é `floor(totalAcumulado_i * personal / total)`, e a da parcela é a diferença para a anterior. A soma bate exatamente com o pessoal informado e nenhuma parcela tem parte pessoal maior que o próprio valor (caso extremo testado: R$ 0,10 com R$ 0,09 pessoal em 10 parcelas). Não usar a regra floor + resto na parte pessoal: nesse caso daria R$ 0,09 pessoal numa parcela de R$ 0,01.
- O comprovante da compra vale para todas as parcelas.

### Recorrentes

- Valor fixo ou variável. Uma Cloud Function agendada diária cria o gasto no dia configurado como `awaiting_confirmation`.

### Mês (competência)

- Fecha só sem gastos `pending_approval`, `returned` ou `awaiting_confirmation`, e com o pagamento do acerto registrado (comprovante PIX ou "pago em dinheiro").
- Fechar e reabrir exigem conexão. Reabrir exige aprovação do outro membro.
- Gasto lançado com data de um mês fechado entra na competência do mês aberto, mantendo a `date` original.
- Gastos de mês fechado são imutáveis (garantir também nas regras do Firestore).

### Offline

Lançar, editar, anexar foto, aprovar e recusar funcionam offline. A consulta à SEFAZ de um QR lido offline acontece quando a conexão volta.

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
  receipt: { type: 'photo' | 'nfce' | 'none', photoPath?, nfceKey?, nfceStatus?: 'pending' | 'ok' | 'failed' }
  status: 'confirmed' | 'pending_approval' | 'returned' | 'awaiting_confirmation'
  rejection?: { byUid, reason?, at }
  recurringId?, installment?: { seriesId, index, count }
  createdBy, createdAt, updatedAt

groups/{groupId}/recurring/{recurringId}
  description, kind: 'fixed' | 'variable', amountCents?, dayOfMonth, payerUid, payerSharePct, active
```

Fotos no Storage em `groups/{groupId}/receipts/{expenseId}.jpg`, comprimidas no aparelho antes do upload. As regras aceitam só membros do grupo, `image/jpeg` e menos de 5 MB.

Regras atuais: as subcoleções do grupo estão liberadas para membros de forma genérica; cada coleção (meses, gastos, recorrentes) ganha regras próprias na fase em que for implementada.

## Risco conhecido: NFC-e

O QR Code atual da NFC-e normalmente não traz o valor; é preciso consultar o portal da SEFAZ-SP, que pode ter captcha. Plano B: o QR preenche data, emitente e chave; o valor é digitado e o QR continua valendo como comprovante.

Prova de conceito (Fase 1): viável com limitações, sem captcha; depende do HTML da página e não tem CORS, então a consulta roda numa Function. Detalhes em `scripts/sefaz-poc/PARECER.md`.

## Fases

1. [x] Fundação: scaffold, Firebase, domínio + testes, build no GitHub Actions, prova de conceito da SEFAZ
2. [x] Acesso: login Google e vínculo do casal por código
3. [ ] Núcleo do acerto: lançamento, painel com saldo, offline
4. [ ] Comprovantes e aprovação
5. [ ] Recorrentes e parcelados (Cloud Functions)
6. [ ] Fechamento, reabertura e histórico
7. [ ] Notificações, exportação Excel/PDF, versão web
8. [ ] Uso real em paralelo com a planilha por um mês

Fora do MVP: categorias com gráficos, importação da planilha.
