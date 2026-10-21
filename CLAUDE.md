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
- Câmera, QR Code e código de barras: plugin Capacitor com ML Kit
- Avisos (push): `@capacitor-firebase/messaging` (FCM nativo, só Android) e `@capawesome/capacitor-badge` (número no ícone, quando o fabricante permite). Canal `avisos`; ícone `ic_stat_notify` (silhueta branca) no AndroidManifest.
- Testes: Vitest (domínio, `npm test`) e emuladores do Firebase para regras e Functions (`npm run test:emulators`, projeto `demo-acerto`)
- Build: GitHub Actions gera o APK assinado e publica no Release (`release.yml`, tag `vX.Y.Z`). `ci.yml` roda os testes e compila um APK de debug a cada push. Instalação por download direto do GitHub.

## Comandos e cuidados do Firebase

- **Regra obrigatória de deploy:** só depois que o CI do commit passar nos dois jobs (`tests` e `android-debug`), e sempre com confirmação explícita do Rodrigo antes de executar, mesmo em modo automático. O mesmo vale para criar e enviar tags de versão (`vX.Y.Z`). O `.claude/settings.json` do projeto marca esses comandos como "ask" (sempre pedem aprovação).
- `npm run emulators` sobe Auth, Firestore, Functions e Storage locais; o app usa os emuladores em dev com `VITE_USE_EMULATORS=true`.
- `node --experimental-transform-types scripts/admin/reconsultar-itens.ts [--gravar]`: reconsulta única dos itens das NFC-e de SP conferidas sem itens (as anteriores ao bloco C da Fase 7). Usa o login da CLI (dono), projeto fixo; por padrão só simula e mostra contagens; `--gravar` cria `nfceItems` com `source: 'backfill'` sem sobrescrever. Rodar com a VPN desligada e só com confirmação explícita do Rodrigo.
- `node --experimental-transform-types scripts/admin/registrar-notas.ts [--gravar]`: registro único (`fiscalKeys`) das notas lançadas antes do bloqueio de nota repetida e lista das notas lançadas mais de uma vez (id, data, competência, quem lançou, valor, mês aberto/fechado; chave só pelos 4 últimos dígitos). Mesmo login e projeto fixo; por padrão só simula; `--gravar` cria só os registros que não existem, apontando para o gasto lançado primeiro (os repetidos ficam para decisão do Rodrigo). Só com confirmação explícita.
- `npm run recorrentes:gerar -- [YYYY-MM | YYYY-MM-DD]` dispara a geração de recorrentes no emulador simulando o dia 1 do mês (padrão: mês atual) ou um dia qualquer. O agendamento não roda no emulador.
- Todo comando da CLI leva `--project acerto-do-casal` explícito. Existe outro projeto Firebase de trabalho na mesma conta: nunca executar comandos nele.
- Antes de um deploy que inclua Firestore ou Storage, confirmar que o banco e o bucket existem e em qual região: o `firebase deploy` cria o banco sozinho na região padrão (`nam5`) quando ele não existe, e a região não muda depois.
- Functions: as opções globais (região, `maxInstances`) ficam em `functions/src/options.ts`, importado antes de qualquer Function; com ESM, `setGlobalOptions` no corpo do `index.ts` roda tarde demais.
- Functions: o `ignore` do `firebase.json` é aplicado com `matchBase` a qualquer pasta (um `"src"` excluía `lib/functions/src` e `lib/src/domain` do pacote); por isso ignora `"*.ts"`. Antes de mudar, simular o pacote com `readdirRecursive` da firebase-tools.
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
| `confirmed` | sim | criado com comprovante (foto ou chave de NF-e/NFC-e), recorrente fixo gerado, ou aprovado pelo outro membro |
| `pending_approval` | sim, destacado | criado sem comprovante, ou qualquer gasto confirmado/devolvido que foi editado |
| `returned` | sim, destacado | recusado (pendente) ou contestado (confirmado automático) pelo outro; volta para quem lançou corrigir ou excluir |
| `awaiting_confirmation` | não | recorrente variável gerado, aguardando quem paga confirmar o valor |

**Quem lança grava o status (as regras exigem exatamente este):**

| situação | status |
| --- | --- |
| criar sem comprovante | `pending_approval` |
| criar com foto ou chave de NF-e/NFC-e (QR, código de barras ou digitada; qualquer estado) | `confirmed` (confirmado automático) |
| editar um confirmado (automático ou aprovado) | `pending_approval` |
| editar um devolvido (recusado ou contestado) | `pending_approval` |
| editar um pendente sem comprovante | `pending_approval` |
| pendente + "Anexar comprovante e dispensar aprovação" | `confirmed` (único caso de edição que confirma: o gasto nunca foi aprovado) |

- **Só a criação com comprovante confirma automaticamente.** Quem lança nunca grava aprovação nem recusa; editar descarta a aprovação/recusa anterior.
- **O outro membro:** num pendente, aprova ou recusa (`rejection.kind: 'reject'`, motivo opcional); num confirmado automático, **valida** (grava `approval { byUid: ele, at }` sem mudar o status) ou **contesta** (`kind: 'contest'`, motivo obrigatório), até o fechamento do mês. Confirmado automático = `confirmed` sem `approval` (ou com `approval.byUid: 'nfce'`, dos gastos da versão anterior). Validado conta como aprovado manualmente: não é contestável e, se editado, volta para aprovação.
- **Selos de status** (`badgeFor` em `src/services/expenseView.ts`, componente `StatusBadge`), diferentes em cor, claridade e ícone:

  | selo | quando | visual |
  | --- | --- | --- |
  | Pendente / Aprovar (para o outro) | `pending_approval` | âmbar claro, relógio |
  | Automático | confirmado automático por chave de NF-e ou NFC-e (QR, código de barras ou digitada; qualquer estado) | branco com contorno azul tracejado, raio |
  | Foto do recibo | confirmado automático por foto | lilás claro com contorno roxo tracejado, câmera |
  | Recorrente aprovado | recorrente fixo gerado no mês (confirmado automático) | verde-azulado médio, contorno contínuo, calendário com check |
  | Validado | `confirmed` aprovado/validado por pessoa | verde escuro preenchido, check |
  | Devolvido (Detalhe: Contestado ou Recusado) | `returned` | vermelho médio, seta de retorno |
  | A confirmar | `awaiting_confirmation` | cinza médio, calendário |
  | Previsto | recorrente ainda não gerado, num mês futuro (não é gasto) | branco com contorno cinza tracejado |

  As cores diferem também em claridade, não só no tom (confirmados, do mais claro ao mais escuro: Automático → Foto do recibo → Recorrente aprovado → Validado). Automático, Foto do recibo e Recorrente aprovado se comportam igual: o outro valida ou contesta.
  O Detalhe mostra a origem (`originLabel`): "Validado por [nome]", "Automático · nota conferida", "Automático · nota fiscal", "Confirmado pela foto do recibo" ou "Gerado do recorrente fixo aprovado".
- **Selos de tipo** (`typeBadges`, componente `TypeBadge`), ao lado do selo de status: "Parcela N/M" e "Recorrente". O "Recorrente" não aparece ao lado de "Recorrente aprovado" (redundante); fica nos variáveis, nos previstos e no fixo editado ou validado.
- **Documento fiscal:** NF-e (modelo 55) ou NFC-e (65), identificado pela chave de 44 dígitos: lida pelo leitor (QR Code da NFC-e ou código de barras Code 128 da chave) ou digitada (aceita os espaços entre os blocos; o app confere dígito verificador e modelo). QR e código de barras da mesma nota dão o mesmo comprovante. Só NFC-e de SP é conferida na SEFAZ, e a conferência apenas registra ok, falha ou valor divergente (aviso), nunca muda o status. NF-e não tem consulta (exige captcha): a chave preenche emitente (CNPJ) e mês, o valor é digitado. Sem consulta à SEFAZ (NF-e, NFC-e de outros estados) ou com a consulta falhando, a Function `lookupCnpj` busca o nome pelo CNPJ (BrasilAPI, cache em `cnpjCache`) e troca a descrição provisória "NF-e SP · CNPJ …" pelo nome fantasia ou, sem ele, pela razão social, se a pessoa ainda não mexeu na descrição (pode editar depois). Offline ou com falha, fica o CNPJ formatado. Origem no Detalhe: "NF-e · chave lida", "NFC-e · chave digitada", com " · conferida" quando a SEFAZ conferiu. Numa NFC-e de SP conferida com os itens lidos, o Detalhe mostra "Ver itens da nota (N)": lista com descrição e "2 UN × R$ 25,90 = R$ 51,80" por item, soma dos itens, descontos, total, formas de pagamento e troco, e o aviso se a soma não bater com o total (`NfceItemsSheet`). Os itens do grupo ficam acompanhados em segundo plano (`src/services/nfceItems.ts`, ligado ao abrir o app) para a lista abrir offline; em parcelados, aparecem em todas as parcelas (mesma chave).
- Seção de comprovante do formulário: Foto, Ler QR ou código de barras (só Android), Digitar chave e Sem comprovante. Com chave, "Anexar foto da nota (opcional)": o comprovante continua sendo a chave (selo Automático) e o Detalhe mostra os dados da chave e a foto ampliável (origem "· com foto"). Anexar a foto depois, num gasto já confirmado, é uma edição e volta para aprovação, sem exceção. A foto da nota segue a fila de fotos e, enquanto não sobe, bloqueia o fechamento como qualquer foto (`receiptHasPhoto` em `src/domain/image.ts`).
- **Nota lançada uma vez só:** cada chave (NF-e ou NFC-e; QR, código de barras ou digitada) tem um registro `fiscalKeys/{chave}` apontando para o gasto (numa série, a parcela 1), gravado no mesmo lote que o gasto (`applyFiscalKeyChange`, `src/services/fiscalKeys.ts`). As regras recusam outro gasto com a mesma chave, em qualquer mês. Ao ler ou digitar uma chave já usada, o formulário avisa "Esta nota já foi lançada em [data] por [nome]: [descrição], R$ X" com "Ver o gasto" e não salva (`duplicateNoteText`); os registros ficam acompanhados em segundo plano para o aviso funcionar offline. Lançado offline e recusado na sincronização por nota repetida: o aviso do lançamento recusado mostra o gasto que tem a nota, sem "Lançar no mês aberto". Excluir o gasto ou trocar/tirar a chave solta o registro no mesmo lote; em mês fechado a chave fica presa. Série com a parcela 1 em mês fechado: a edição esconde ler/digitar chave. Notas repetidas anteriores ao registro continuam editáveis mantendo a chave.
- Só quem lançou edita ou exclui o gasto.
- **Observação** (opcional, até 300 caracteres): no lançamento, na confirmação do valor do recorrente variável e na edição da série (é da série). Aparece completa no Detalhe; resumida em uma linha (`noteSummary`, ~60 caracteres) em Pendências e nos avisos de gasto para aprovar e de confirmado automático, depois da origem ("… · toque para aprovar — “churrasco do sábado”", "… · foto do recibo — “feira do mês”").
- A mesma regra de edição vale para recorrentes fixos e séries de parcelas.

### Parcelados

- Informa total, número de parcelas e mês da primeira. Gera uma parcela por mês com a mesma divisão e parte pessoal proporcional.
- Valor por parcela = `floor(total / n)`; o resto dos centavos vai na primeira parcela.
- Parte pessoal por arredondamento acumulado: a parte pessoal acumulada até a parcela *i* é `floor(totalAcumulado_i * personal / total)`, e a da parcela é a diferença para a anterior. A soma bate exatamente com o pessoal informado e nenhuma parcela tem parte pessoal maior que o próprio valor (caso extremo testado: R$ 0,10 com R$ 0,09 pessoal em 10 parcelas). Não usar a regra floor + resto na parte pessoal: nesse caso daria R$ 0,09 pessoal numa parcela de R$ 0,01.
- O comprovante da compra vale para todas as parcelas.
- Lançamento pelo formulário de novo gasto, opção "Compra parcelada": 2 a 48 parcelas e mês da primeira (do mês da compra, no máximo 6 meses atrás, até o mês seguinte ao atual; nunca um mês fechado). O valor digitado é o total da compra; a prévia mostra o valor de cada parcela. Funções puras em `src/domain/installments.ts`.
  - Teste em produção (2026-10-18): série de 48 parcelas lançada e excluída num lote, OK. O limite de 6 meses para trás não pôde ser testado, porque o grupo foi criado em out/2026 e a primeira parcela não vai antes do mês de criação. Observar quando houver histórico: uma série longa começando em meses passados é o caso que mais gasta leituras das regras (cada mês passado é conferido como aberto).
- Cada parcela é um gasto com `installment { seriesId, index, count, firstMonth, purchaseCents }` (`purchaseCents` = total da compra; as regras conferem o valor de cada parcela contra ele); a parcela 1 tem o id da série, as outras `{seriesId}-{index}`. Data de cada parcela: o dia da compra no mês dela (29–31 viram o último dia nos meses curtos). Todas são gravadas num único lote (offline também).
- Status pela regra do comprovante, igual para a série: sem comprovante, todas pendentes (a série é aprovada uma vez); com foto ou QR, todas confirmadas. A foto fica em `receipts/{seriesId}.jpg`; a fila marca todas as parcelas como enviadas. A NFC-e é consultada só pela parcela 1, que repassa o resultado às outras; a comparação de valor usa o total da compra.
- **Ações valem para a série inteira**, nas parcelas de meses abertos (`seriesTargets` em `src/services/series.ts`), num lote: aprovar e recusar (as pendentes), validar e contestar (as confirmadas automaticamente).
- **Edição da série** (só quem lançou, parcelas de meses abertos): descrição, quem pagou, divisão e comprovante; parcela confirmada editada volta para pendente (mesma regra de edição). Valor, parte pessoal, data, número de parcelas e primeiro mês não mudam: exclui a compra e lança de novo.
- Selo de tipo "Parcela N/M" em toda parcela, ao lado do selo de status. Em Pendências, uma linha por série, com o total da compra e "10x de R$ 214,00 · out/2026 a jul/2027". No Detalhe de uma parcela, o valor grande é o total da compra, com "48x de R$ 100,00 · esta é a parcela 1 (out/2026)" em destaque logo abaixo; o cartão "Compra parcelada" mostra só o período ("de out/2026 a set/2030"); a memória de cálculo fala "por esta parcela"; os botões têm duas linhas, verbo em cima e total embaixo ("Aprovar compra" / "R$ 4.800,00"; idem Recusar, Validar e Contestar).

### Recorrentes

- Cadastro em Ajustes > Contas recorrentes: descrição, fixo ou variável, valor (só fixo), dia do vencimento, quem paga, divisão, mês inicial, mês final opcional, ativa.
- **Fixo** passa pela aprovação do outro membro uma vez (recusado, quem cadastrou corrige e volta para aprovação). **Variável** não precisa de aprovação. Descrição, dia, mês inicial/final e ativa mudam direto, sem aprovação.
- **Reajuste** (valor, quem paga, divisão ou tipo de um cadastro já aprovado, com fixo de um dos lados): vale só daqui para frente e exige aprovação do outro membro. A versão aprovada fica nos campos do cadastro (é a que a geração usa) e a proposta em `proposal`. Aprovado, a proposta passa a ser a versão aprovada e vale a partir da próxima geração; o gasto do mês já gerado não muda (para o valor novo no mês, edita-se o gasto, que vai para aprovação). Recusado, a proposta some e a versão aprovada continua. Voltar o formulário à versão aprovada cancela o reajuste. No variável, quem paga e divisão mudam direto; virar fixo é reajuste (gera como variável até a aprovação).
- Selo do cadastro: Pendente/Aprovar (fixo novo), Reajuste pendente/Aprovar reajuste, Recusada, Ativa, Desativada.
- Só quem cadastrou edita; qualquer um dos dois desativa.
- **Geração**: todos os recorrentes ativos e aprovados são gerados no **dia 1** do mês (execução às 6h de São Paulo), com `date` = dia do vencimento (29–31 viram o último dia nos meses curtos). A Function `generateRecurringDaily` roda todo dia para gerar no dia seguinte os cadastrados ou aprovados no meio do mês e recuperar execuções perdidas. Idempotente: id do gasto `rec-{recurringId}-{YYYY-MM}` e `lastGeneratedMonth` no cadastro, em transação; gasto excluído não é recriado.
- Gasto gerado: fixo nasce `confirmed` (automático, contestável; editar → `pending_approval`); variável nasce `awaiting_confirmation` com valor 0 e `createdBy` = quem paga, que confirma o valor (depois vale a regra do comprovante). `recurringId` só a Function grava.
- **Previsão**: só nos meses futuros navegáveis (o mês atual já foi gerado), o Painel mostra os recorrentes ativos ainda não gerados, calculados na hora (`forecastRecurring` em `src/domain/recurrence.ts`, nada gravado), com selo "Previsto" e "Recorrente"; variável com valor "a definir". Fora do saldo; o cartão mostra "Previsto em recorrentes" (só fixos). A previsão **não** estende o limite de navegação. O toque numa previsão não abre a edição do cadastro: abre um painel curto (`forecastNotice`, `src/services/recurringView.ts`) com "[descrição] · previsto para [data]. Este gasto será gerado em 1º de [mês]" e, no variável, quem informa o valor ("Você poderá informar o valor quando ele aparecer em Pendências"), com "Ver cadastro".
- Pendências: "Recorrentes para confirmar" (variáveis aguardando o seu valor e cadastros fixos do outro para aprovar).

### Mês (competência)

- Fecha só sem gastos `pending_approval`, `returned` ou `awaiting_confirmation`, e com o pagamento do acerto registrado (comprovante PIX ou "pago em dinheiro").
- Fecha só sem foto de comprovante pendente de envio (foto de recibo ou da nota junto com a chave, com `photoUploaded: false`); a aprovação não depende da foto ter chegado.
- Só fecha mês passado ou atual, nunca futuro (as regras tratam mês futuro como aberto sem consultar o banco).
- Fechar e reabrir exigem conexão. Reabrir exige aprovação do outro membro.
- Gasto lançado com data de um mês fechado entra na competência do mês aberto, mantendo a `date` original.
- Gastos de mês fechado são imutáveis (garantir também nas regras do Firestore).
- Tela "Fechar [mês]" (a partir do Painel, só mês atual ou passado): resultado ("Você paga R$ X a Bia", "Bia te paga R$ X" ou "Ninguém deve nada") e memória de cálculo (`monthBreakdown` em `src/domain/closing.ts`: total lançado, partes pessoais, total no rateio, parte de cada um, quanto cada um pagou do rateio e diferença; mesmo arredondamento do saldo). Bloqueada com a lista do que falta (`closeBlockers`) e atalho para Pendências, sem conexão, ou com acerto por pagar (`closeReasons`).
- Acerto como lista de pagamentos (`remainingTransfer`): quem deve o que falta registra, com foto do PIX ou "Pago em dinheiro", sempre o valor exato. Saldo zero fecha sem pagamento. Depois de reabrir, os pagamentos anteriores continuam valendo e falta só o complemento, ou a devolução no sentido contrário se o saldo diminuiu. Qualquer um dos dois fecha. A lista de pagamentos (componente `PaymentList`, também no Detalhe do mês do Histórico) mostra valor, sentido, forma, quem registrou e quando; no PIX, a miniatura do comprovante abre a foto ampliável, e enquanto a foto sobe aparece "Comprovante sendo enviado".
- Painel de um mês fechado: o cartão do saldo vira "Acerto de [mês] · pago", com quem pagou quanto a quem, a forma e a data (ou "Ninguém deve nada"), mantendo "Você pagou / [nome] pagou"; no lugar do botão de fechar, a linha "Mês fechado em [data] por [nome] · Ver o acerto · Pedir reabertura" (link discreto).
- Reabertura: o pedido abre um diálogo com motivo obrigatório e o aviso de que o outro precisa aprovar (`askReopenReason`). Com pedido pendente, aviso em destaque (componente `ReopenPanel`, também na tela do mês fechado e no Histórico): quem pediu vê "Reabertura aguardando [nome]" e pode cancelar; o outro vê o motivo e aprova ou recusa. Só com conexão.
- Histórico (aba): meses do atual ao de criação do grupo (`monthsDesc`), cada um com a situação (Fechado, Aberto, Em andamento, Reaberto) e, se fechado, o resultado do acerto e a forma do pagamento (`historyRow`); fechado abre o Detalhe do mês, aberto abre o Painel. Detalhe do mês fechado: linha de fechamento, reabertura (`ReopenPanel`), resultado, memória de cálculo guardada no fechamento (`BreakdownCard`, o mesmo da tela de fechamento), pagamentos (`PaymentList`) e os gastos do mês. Pendências mostra "Reabertura para aprovar" quando o outro pediu. Exportação Excel/PDF fica para a Fase 7.
- Gasto lançado offline num mês que fecha antes de sincronizar é recusado pelas regras. Todo lançamento novo fica guardado no aparelho (IndexedDB, com cópia da foto) até o servidor confirmar (`src/services/launchGuard.ts`, decisão pura em `launchState`, `src/domain/launches.ts`); a verificação roda ao abrir o app, quando a conexão volta, a cada minuto e logo após uma recusa, então vale também depois de fechar e reabrir o app. O aviso mostra descrição, valor e data (`expenseLabel`) com "Lançar no mês aberto" (mesmos dados, competência do mês aberto, data original) ou "Descartar". Compra parcelada recusada: só o aviso (relançar mudaria os meses da série); edição recusada não é relançada (o gasto original está no mês fechado).

### Avisos (push) e contador

- Sempre para o outro membro: ninguém é avisado da própria ação. Regras puras em `src/domain/notifications.ts` (texto, rota do toque e categoria), aplicadas pelas Functions de `functions/src/notify.ts`.
- Eventos: gasto lançado (pendente: "toque para aprovar"; confirmado automático: a origem, "foto do recibo", "nota conferida", "NF-e"); devolvido (recusado ou contestado, com o motivo); correção para aprovação; valor de recorrente variável confirmado; comprovante anexado a um pendente; pagamento do acerto registrado (para quem recebe conferir); mês fechado; pedido de reabertura (com motivo) e resposta; recorrente fixo ou reajuste para aprovar. No dia 1, para quem paga, um único aviso resumindo os variáveis a confirmar. Série de parcelas: um aviso só, nunca um por parcela. Sem aviso: aprovar, validar, excluir, recorrente gerado.
- Categorias que cada um liga ou desliga em Ajustes › Avisos: Gastos, Devoluções, Acerto e fechamento, Recorrentes.
- Permissão (Android 13+): o Painel explica antes ("Ativar avisos" / "Agora não", uma vez só); depois, só em Ajustes › Avisos. Com o app aberto, o aviso aparece dentro do app com "Abrir". O toque abre a tela do aviso.
- Aparelho: um documento por usuário e aparelho (`users/{uid}/devices/{deviceId}`), atualizado quando o FCM renova o token e apagado ao sair da conta.
- Contador na aba Pendências e no ícone do app (`actionCount`, o mesmo nas Functions, que mandam o número no aviso):
  - Conta só o que depende de ação de quem vê: "Para você aprovar", "Devolvidos para você corrigir", "Recorrentes para confirmar" (variáveis, cadastros e reajustes) e "Reabertura para aprovar". Não conta "Aguardando [nome] aprovar" nem automáticos não validados. Regra pura em `actionCount` (`src/domain/notifications.ts`), a mesma no app e nas Functions (número do aviso).
  - Série de parcelas conta 1. Acima de 9, mostra "9+". Sem pendências, o número não aparece.
  - Número no ícone: depende do fabricante (Samsung, Xiaomi e outros mostram; alguns só um ponto).

### Offline

Lançar, editar, anexar foto, aprovar e recusar funcionam offline. A consulta à SEFAZ de um QR lido offline acontece quando a conexão volta.

### Datas e navegação

- Data de um gasto: do mês de criação do grupo até o fim do mês seguinte ao atual (São Paulo). As regras validam o limite superior em UTC, o que as deixa no máximo um mês mais permissivas na virada, nunca mais restritivas.
- Navegação do Painel: do mês de criação do grupo até o mês seguinte ao atual, estendida até o mês da última parcela existente (`navigationLastMonth`; a previsão de recorrentes não estende). Parcelas são o único gasto além do limite de datas.
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

users/{uid}                      // cada um lê e grava só o próprio
  notificationPrefs: { expenses?, returns?, settlement?, recurring? }   // false desliga; ausente = ligado
users/{uid}/devices/{deviceId}   // um por aparelho (push); as Functions apagam tokens recusados pelo FCM
  token, platform: 'android', appVersion, updatedAt

groups/{g}/notificationLog/{chave}  // só Functions: um aviso por lote numa série; apagado por TTL (expireAt, 7 dias)

memberships/{uid}                // só Functions escrevem; cada um lê o próprio
  groupId

invites/{code}                   // só Functions; app sem acesso
  groupId, createdBy, expiresAt

groups/{g}/fiscalKeys/{chave44}  // nota lançada: um por chave, no mesmo lote que o gasto; membros leem
  expenseId, createdBy, createdAt  // expenseId: o gasto ou, numa série, a parcela 1

cnpjCache/{cnpj}                 // só Functions; app sem acesso: nome do emitente pelo CNPJ (BrasilAPI)
  name, fantasyName, legalName, fetchedAt

joinAttempts/{uid}               // só Functions; app sem acesso
  failures, windowStart

groups/{groupId}/months/{YYYY-MM}  // sem documento = aberto; só as Functions gravam
  status: 'open' | 'closed'
  payments?: [{ id, fromUid, toUid, amountCents, method: 'pix' | 'cash', receiptPath?, byUid, at }]
      // acerto como lista: fecha quando a soma líquida bate com o saldo; após reabrir, paga-se o complemento ou a devolução
  summary?: { expenseCount, totalCents, personalCents, sharedCents, byMember: { [uid]: { shareCents, paidSharedCents, diffCents } }, result }
      // memória de cálculo guardada ao fechar (sai ao reabrir)
  closedAt?, closedBy?, reopenedAt?
  reopenRequest?: { byUid, reason, at, status: 'pending' | 'approved' | 'denied', answeredBy?, answeredAt? }

groups/{groupId}/expenses/{expenseId}
  description, totalCents, personalCents, payerUid, payerSharePct
  date: 'YYYY-MM-DD', competence: 'YYYY-MM'
  receipt:
    { type: 'none' }
    | { type: 'photo', photoPath: 'groups/{g}/receipts/{id}.jpg', photoUploaded: bool }
    | { type: 'nfce', nfceKey (44 dígitos; NF-e modelo 55 ou NFC-e 65), entry: 'read' | 'typed',
        nfceUrl? (só NFC-e de SP: `...ConsultaQRCode.aspx?p={chave}|3|1`, montada da chave),
        nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked', nfceData?: { issuerName, totalCents, date }, nfceError?,
        photoPath?, photoUploaded? }   // foto da nota anexada à chave (opcional), no mesmo caminho das fotos de recibo
        // app grava 'pending' (NFC-e de SP) ou 'unchecked' (NF-e e outros estados); ok/failed e nfceData: só a Function
        // gastos anteriores ao bloco D da Fase 5 não têm `entry` (lidos por QR) e guardam a URL com o hash do QR
  status: 'confirmed' | 'pending_approval' | 'returned' | 'awaiting_confirmation'
  approval?: { byUid, at }        // byUid 'nfce' = confirmado pela conferência da nota (só a Function grava)
  rejection?: { byUid, reason? (até 200), at }
  recurringId?, installment?: { seriesId, index, count, firstMonth, purchaseCents }
  note?                           // observação de quem lançou, 1..300 caracteres (numa série, a mesma em todas as parcelas)
  createdBy, createdAt, updatedAt

groups/{groupId}/nfceItems/{nfceKey}  // itens da NFC-e de SP; só Functions gravam (e a reconsulta); membros leem
  items: [{ description, code?, quantity, unit, unitPrice (texto, como na nota), totalCents }]
  grossCents?, discountCents, totalCents, payments: [{ method, amountCents }], changeCents?
  itemsSumCents, consistent        // soma dos itens − descontos = total da nota
  fetchedAt, source: 'checkNfce' | 'backfill'

groups/{groupId}/recurring/{recurringId}
  description, kind: 'fixed' | 'variable', amountCents?, dayOfMonth, payerUid, payerSharePct
  startMonth: 'YYYY-MM', endMonth?, active
  status: 'pending_approval' | 'approved' | 'returned', approval?, rejection?
  proposal?: { kind, amountCents?, payerUid, payerSharePct, at }   // reajuste aguardando aprovação
  lastGeneratedMonth?            // só a Function grava
  createdBy, createdAt, updatedAt
```

Fotos no Storage em `groups/{groupId}/receipts/{expenseId}.jpg`, comprimidas no aparelho antes do upload. As regras aceitam só membros do grupo, `image/jpeg` e menos de 5 MB.
Comprovantes PIX do acerto em `groups/{groupId}/settlements/{YYYY-MM}/{paymentId}.jpg`: membros enviam (arquivo novo, JPEG até 1 MB) enquanto o mês não está fechado e leem; sem troca nem exclusão.

Regras atuais (`firestore.rules` e `storage.rules`, testadas em `tests/emulators/`):
- `expenses`: só membros leem. Centavos inteiros, total > 0, pessoal ≤ total, pct inteiro 0..100, pagador membro, descrição 1..80, observação opcional 1..300 (só quem lançou grava; mudá-la num confirmado volta para aprovação, como qualquer edição), data até o fim do mês seguinte, competência coerente com a data e nunca em mês fechado.
- **Quem lança** (criar e editar): todos os campos e nenhum a mais, `createdBy` = quem cria, horários do servidor, `status` conforme a regra do comprovante e da edição (tabelas acima), sem `approval`/`rejection` (a edição apaga as anteriores); `recurringId` nunca na criação e inalterado na edição. Comprovante: foto no caminho do próprio gasto (não enviada na criação); chave de 44 dígitos, modelo 55 ou 65, com `entry` 'read' ou 'typed': NFC-e de SP só `'pending'` com a URL montada da própria chave (`p=chave|3|1`), NF-e e NFC-e de outros estados só `'unchecked'` sem URL; ou mantido sem mudança na edição; com a chave, foto opcional da nota no caminho do próprio gasto (não enviada na criação), e na edição a mesma chave pode mudar só a foto, mantendo a conferência. O dígito verificador é conferido no app e na Function (as regras não calculam o módulo 11). Exceção estreita: a fila de fotos pode só virar `receipt.photoUploaded` para `true` (foto de recibo ou da nota), sem mexer no status.
- **Nota repetida** (`fiscalKeys/{chave}`): criar um gasto com chave, ou trocar/incluir a chave na edição, exige o registro apontando para ele (ou a série) ao fim do lote; tirar/trocar a chave ou excluir o gasto exige soltar o registro, salvo se ele for de outro gasto (repetida anterior ao registro) ou da parcela 1 que ainda usa a chave. O registro é criado só se não existe, por quem lançou o gasto que passa a usar a chave, com horário do servidor; nunca é alterado; sai só quando o gasto apontado não existe mais ou não usa mais a chave. Editar mantendo a chave não exige registro. Testes de abuso em `tests/emulators/fiscalKeys.rules.spec.ts`.
- **Outro membro**: em `pending_approval` aprova (`→ confirmed`, `approval.byUid` = ele) ou recusa (`→ returned`, motivo opcional); em automático valida (grava `approval` sem mudar o status) ou contesta (`→ returned`, motivo obrigatório). Não toca em valores nem no comprovante.
- **Function `lookupCnpj`** (callable): só para quem faz parte de um grupo; confere o CNPJ (dígitos verificadores), usa o cache e só então a BrasilAPI (no emulador, respostas fictícias, sem rede); guarda só o que achou; falha ou não encontrado devolve `name: null`. Funções puras em `functions/src/cnpj.ts`.
- **Function `checkNfce`** (gatilho): consulta a SEFAZ quando o QR chega ao servidor; só grava `nfceStatus`/`nfceData`, nunca muda o status. Numa série, só a parcela 1 consulta e grava em todas. Da mesma página, lê os itens (`parseItems`/`checkItems` em `functions/src/nfce.ts`) e grava `nfceItems/{chave}`, um por nota (numa série, vale para todas as parcelas); falha na leitura dos itens não afeta a conferência. No emulador, a página vem de `emulatorFixtures/sefaz_{chave}` (testes, sem rede). `resolveNfce` (callable) só pré-preenche o formulário.
- **Nova consulta** ("Tentar conferir de novo"): exceção estreita para quem lançou voltar uma NFC-e de SP `failed` para `pending`, sem mexer em mais nada (nem no status).
- **Parcelas**: exceção ao limite de datas só dentro de série válida: primeiro mês dentro do limite, competência = primeiro mês + índice − 1, id no padrão e, na criação, a parcela 1 da mesma série (mesmo número de parcelas e primeiro mês) existe no mesmo lote ou antes, do mesmo autor. Na edição, `installment`, valor, parte pessoal, data e competência não mudam. Mês futuro nunca é consultado como fechado (sem leitura), o que deixa um lote de 48 parcelas dentro do limite de leituras das regras; a Fase 6 não pode fechar mês futuro.
- `recurring`: só membros leem. Ainda não aprovado (novo, pendente, recusado): quem cadastrou grava variável `approved` e fixo `pending_approval`, sem `approval`/`proposal`; o outro aprova ou recusa. Já aprovado: quem cadastrou mantém status, aprovação e versão aprovada; o dinheiro só muda direto entre variáveis, senão vai em `proposal` (diferente da versão aprovada, valores válidos, `at` do servidor); o outro aprova (versão aprovada = `proposal`, nova `approval`) ou recusa (`proposal` some, versão aprovada intacta). Qualquer um desativa; só quem cadastrou exclui. `lastGeneratedMonth` só pelo Admin SDK.
- Exclusão: só quem lançou, nunca em mês fechado. `months`: só leitura para o app; fechamento, pagamento e reabertura só pelas Functions callable (`functions/src/closing.ts`), cada uma numa transação com as mesmas funções de `src/domain/closing.ts`:
  - `registerPayment`: só quem deve pagar o que falta (saldo − pagamentos), sempre o valor exato; PIX exige a foto já no Storage.
  - `closeMonth`: qualquer membro; mês atual ou passado (nunca futuro); sem pendentes, devolvidos, recorrentes a confirmar ou fotos não enviadas; acerto pago (saldo zero fecha sem pagamento). Guarda a memória de cálculo.
  - `requestReopen` (motivo obrigatório), `answerReopen` (só o outro membro; aprovado volta a aberto, os pagamentos continuam valendo) e `cancelReopen` (quem pediu).
- Avisos (push): gatilhos `notifyExpense`, `notifyMonth` e `notifyRecurring` (`functions/src/notify.ts`) aplicam as regras de `src/domain/notifications.ts` ao antes/depois do documento; o resumo do dia 1 sai de `generateRecurring`. Cada aviso respeita a categoria ligada/desligada de quem recebe, vai para todos os aparelhos dele com o contador (`actionCount`) como número do ícone (`notificationCount`) e canal `avisos`; numa série, ações em lote geram um aviso só (`notificationLog`, chave da série + instante do lote). No emulador, os avisos vão para `notificationOutbox` (testes) e tokens "invalid-…" simulam a recusa do FCM.
- Subcoleções sem regra própria ficam fechadas.
- Storage: só quem lançou o gasto (tipo foto, ou chave com foto anexada) envia/troca/apaga a foto, JPEG até 1 MB; membros leem. Cada regra faz uma única leitura no Firestore (por isso o app apaga a foto antes do documento). Exige a permissão do agente do Storage para ler o Firestore (papel "Firebase Rules Firestore Service Agent").
- `src/services/expenseData.ts` monta os documentos (gasto, edição, aprovação, recusa) como o app grava; os testes de regras usam as mesmas funções.

Comprovantes no app:
- Foto: câmera ou galeria (`@capacitor/camera`), comprimida no aparelho para JPEG < 500 KB (`src/domain/image.ts`) e guardada numa fila no IndexedDB (`src/services/photoQueue.ts`) até subir; só sobe depois que o gasto existe no servidor.
- Leitor: o do Google (ML Kit, só Android, sem permissão de câmera), para QR Code e código de barras Code 128; lido no aparelho com o mesmo parser das Functions (`parseFiscalCode`, `parseNfceQr` e `parseTypedKey` em `functions/src/nfce.ts`). Aceita QR de qualquer SEFAZ (`p=` das versões 2 e 3, `chNFe=` da versão 1, ou a chave no texto), as variações da URL de SP (http/https, com ou sem www, `/qrcode` ou `ConsultaQRCode.aspx`) e os 44 dígitos do código de barras. Para NFC-e de SP monta a URL de consulta só da chave (`spConsultUrl`: `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p={chave}|3|1`, formato do QR versão 3); a rede só é acessada nela, nunca no endereço lido, e sem seguir redirecionamentos.
- Chave digitada: funciona também na versão web.

## Risco conhecido: NFC-e

O QR Code atual da NFC-e normalmente não traz o valor; é preciso consultar o portal da SEFAZ, que pode ter captcha. Só NFC-e de SP tem consulta automática; NF-e (a consulta exige captcha) e notas de outros estados valem como comprovante sem consulta. Plano B (SP, se a consulta falhar): a chave preenche data, emitente e mês; o valor é digitado e a chave continua valendo como comprovante.

Consulta pela URL montada da chave (`chave|3|1`, sem o hash do QR versão 2): adotada no bloco D da Fase 5 para que QR, código de barras e chave digitada deem o mesmo comprovante. Validado em 2026-10-18 com 9 notas reais (8 com QR versão 2, 1 com versão 3) por `scripts/sefaz-poc/testar-chave-v3.ts`, que lê as URLs de um arquivo `*.local.txt`: as 9 consultadas pela chave, com os mesmos dados do QR original nas 8 em que ele também funcionou (na 9ª, o hash do QR estava inválido). A consulta pela chave dispensa o hash: confere a nota pela chave, não a autenticidade do QR. Com VPN ligada no PC, a SEFAZ recusa qualquer consulta ("Formato de QR-Code não suportado"): desligar antes de testar.

Prova de conceito (Fase 1): viável com limitações, sem captcha; depende do HTML da página e não tem CORS, então a consulta roda numa Function. Confirmado na nuvem na Fase 4 (6 de 6 notas a partir de `southamerica-east1`). Detalhes em `scripts/sefaz-poc/PARECER.md`.

## Fases

1. [x] Fundação: scaffold, Firebase, domínio + testes, build no GitHub Actions, prova de conceito da SEFAZ
2. [x] Acesso: login Google e vínculo do casal por código
3. [x] Núcleo do acerto: lançamento, painel com saldo, offline
4. [x] Comprovantes e aprovação
5. [x] Recorrentes e parcelados (Cloud Functions)
6. [x] Fechamento, reabertura e histórico
   - Pendência: validar o registro do PIX com foto em produção no fechamento de outubro/2026.
7. [ ] Notificações, exportação Excel/PDF, versão web
   - [x] Bloco A: notificações (push, preferências por categoria, contador na aba e no ícone), v0.7.0.
   - [x] Bloco B: lançamento (observação, foto da nota junto com a chave, nome do emitente pelo CNPJ, "Lançar no mês aberto" para gasto recusado na sincronização), v0.7.1.
   - [x] Bloco C: itens da NFC-e de SP (lidos pela `checkNfce`, "Ver itens da nota" no Detalhe, offline; reconsulta das notas antigas por `scripts/admin/reconsultar-itens.ts`), v0.7.1.
   - [ ] Bloco D: exportação Excel/PDF (do mês e do histórico).
   - [ ] Bloco E: segurança do projeto.
     - Restringir as chaves de API do Firebase (web e Android) no Google Cloud Console: só as APIs usadas, com restrição por site (web) e por pacote + SHA-1 da assinatura (Android).
     - Proteger as tags `v*` no GitHub (Rulesets): só o dono cria, ninguém move nem apaga; a tag dispara o release do APK assinado.
   - Pendência herdada da Fase 4: limpar fotos órfãs no Storage (foto já enviada de um gasto que trocou para "Sem comprovante" ou para QR, ou excluído offline).
   - Pendência herdada da Fase 4 (prioridade baixa): reduzir o tamanho do APK (de ~6 MB para ~31,5 MB com a leitura de QR); avaliar o modelo de QR via Google Play Services em vez do embutido no APK.
8. [ ] Uso real em paralelo com a planilha por um mês

Fora do MVP: categorias com gráficos, importação da planilha.
