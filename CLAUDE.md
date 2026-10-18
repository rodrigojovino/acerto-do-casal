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
- `npm run recorrentes:gerar -- [YYYY-MM | YYYY-MM-DD]` dispara a geração de recorrentes no emulador simulando o dia 1 do mês (padrão: mês atual) ou um dia qualquer. O agendamento não roda no emulador.
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
| `confirmed` | sim | criado com comprovante (foto ou QR), recorrente fixo gerado, ou aprovado pelo outro membro |
| `pending_approval` | sim, destacado | criado sem comprovante, ou qualquer gasto confirmado/devolvido que foi editado |
| `returned` | sim, destacado | recusado (pendente) ou contestado (confirmado automático) pelo outro; volta para quem lançou corrigir ou excluir |
| `awaiting_confirmation` | não | recorrente variável gerado, aguardando quem paga confirmar o valor |

**Quem lança grava o status (as regras exigem exatamente este):**

| situação | status |
| --- | --- |
| criar sem comprovante | `pending_approval` |
| criar com foto ou QR (qualquer estado) | `confirmed` (confirmado automático) |
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
  | Automático | confirmado automático por QR Code (qualquer estado) | branco com contorno azul tracejado, raio |
  | Foto do recibo | confirmado automático por foto | lilás claro com contorno roxo tracejado, câmera |
  | Recorrente aprovado | recorrente fixo gerado no mês (confirmado automático) | verde-azulado médio, contorno contínuo, calendário com check |
  | Validado | `confirmed` aprovado/validado por pessoa | verde escuro preenchido, check |
  | Devolvido (Detalhe: Contestado ou Recusado) | `returned` | vermelho médio, seta de retorno |
  | A confirmar | `awaiting_confirmation` | cinza médio, calendário |
  | Previsto | recorrente ainda não gerado, num mês futuro (não é gasto) | branco com contorno cinza tracejado |

  As cores diferem também em claridade, não só no tom (confirmados, do mais claro ao mais escuro: Automático → Foto do recibo → Recorrente aprovado → Validado). Automático, Foto do recibo e Recorrente aprovado se comportam igual: o outro valida ou contesta.
  O Detalhe mostra a origem (`originLabel`): "Validado por [nome]", "Automático · nota conferida", "Automático · nota fiscal", "Confirmado pela foto do recibo" ou "Gerado do recorrente fixo aprovado".
- **Selos de tipo** (`typeBadges`, componente `TypeBadge`), ao lado do selo de status: "Parcela N/M" e "Recorrente". O "Recorrente" não aparece ao lado de "Recorrente aprovado" (redundante); fica nos variáveis, nos previstos e no fixo editado ou validado.
- **QR:** a conferência na SEFAZ (só SP) apenas registra ok, falha ou valor divergente (aviso), e nunca muda o status.
- Só quem lançou edita ou exclui o gasto.
- A mesma regra de edição vale para recorrentes fixos e séries de parcelas.

### Parcelados

- Informa total, número de parcelas e mês da primeira. Gera uma parcela por mês com a mesma divisão e parte pessoal proporcional.
- Valor por parcela = `floor(total / n)`; o resto dos centavos vai na primeira parcela.
- Parte pessoal por arredondamento acumulado: a parte pessoal acumulada até a parcela *i* é `floor(totalAcumulado_i * personal / total)`, e a da parcela é a diferença para a anterior. A soma bate exatamente com o pessoal informado e nenhuma parcela tem parte pessoal maior que o próprio valor (caso extremo testado: R$ 0,10 com R$ 0,09 pessoal em 10 parcelas). Não usar a regra floor + resto na parte pessoal: nesse caso daria R$ 0,09 pessoal numa parcela de R$ 0,01.
- O comprovante da compra vale para todas as parcelas.
- Lançamento pelo formulário de novo gasto, opção "Compra parcelada": 2 a 48 parcelas e mês da primeira (do mês da compra, no máximo 6 meses atrás, até o mês seguinte ao atual; nunca um mês fechado). O valor digitado é o total da compra; a prévia mostra o valor de cada parcela. Funções puras em `src/domain/installments.ts`.
- Cada parcela é um gasto com `installment { seriesId, index, count, firstMonth }`; a parcela 1 tem o id da série, as outras `{seriesId}-{index}`. Data de cada parcela: o dia da compra no mês dela (29–31 viram o último dia nos meses curtos). Todas são gravadas num único lote (offline também).
- Status pela regra do comprovante, igual para a série: sem comprovante, todas pendentes (a série é aprovada uma vez); com foto ou QR, todas confirmadas. A foto fica em `receipts/{seriesId}.jpg`; a fila marca todas as parcelas como enviadas. A NFC-e é consultada só pela parcela 1, que repassa o resultado às outras; a comparação de valor usa o total da compra.
- **Ações valem para a série inteira**, nas parcelas de meses abertos (`seriesTargets` em `src/services/series.ts`), num lote: aprovar e recusar (as pendentes), validar e contestar (as confirmadas automaticamente).
- **Edição da série** (só quem lançou, parcelas de meses abertos): descrição, quem pagou, divisão e comprovante; parcela confirmada editada volta para pendente (mesma regra de edição). Valor, parte pessoal, data, número de parcelas e primeiro mês não mudam: exclui a compra e lança de novo.
- Selo de tipo "Parcela N/M" em toda parcela, ao lado do selo de status. Em Pendências, uma linha por série.

### Recorrentes

- Cadastro em Ajustes > Contas recorrentes: descrição, fixo ou variável, valor (só fixo), dia do vencimento, quem paga, divisão, mês inicial, mês final opcional, ativa.
- **Fixo** passa pela aprovação do outro membro uma vez (recusado, quem cadastrou corrige e volta para aprovação). **Variável** não precisa de aprovação. Descrição, dia, mês inicial/final e ativa mudam direto, sem aprovação.
- **Reajuste** (valor, quem paga, divisão ou tipo de um cadastro já aprovado, com fixo de um dos lados): vale só daqui para frente e exige aprovação do outro membro. A versão aprovada fica nos campos do cadastro (é a que a geração usa) e a proposta em `proposal`. Aprovado, a proposta passa a ser a versão aprovada e vale a partir da próxima geração; o gasto do mês já gerado não muda (para o valor novo no mês, edita-se o gasto, que vai para aprovação). Recusado, a proposta some e a versão aprovada continua. Voltar o formulário à versão aprovada cancela o reajuste. No variável, quem paga e divisão mudam direto; virar fixo é reajuste (gera como variável até a aprovação).
- Selo do cadastro: Pendente/Aprovar (fixo novo), Reajuste pendente/Aprovar reajuste, Recusada, Ativa, Desativada.
- Só quem cadastrou edita; qualquer um dos dois desativa.
- **Geração**: todos os recorrentes ativos e aprovados são gerados no **dia 1** do mês (execução às 6h de São Paulo), com `date` = dia do vencimento (29–31 viram o último dia nos meses curtos). A Function `generateRecurringDaily` roda todo dia para gerar no dia seguinte os cadastrados ou aprovados no meio do mês e recuperar execuções perdidas. Idempotente: id do gasto `rec-{recurringId}-{YYYY-MM}` e `lastGeneratedMonth` no cadastro, em transação; gasto excluído não é recriado.
- Gasto gerado: fixo nasce `confirmed` (automático, contestável; editar → `pending_approval`); variável nasce `awaiting_confirmation` com valor 0 e `createdBy` = quem paga, que confirma o valor (depois vale a regra do comprovante). `recurringId` só a Function grava.
- **Previsão**: só nos meses futuros navegáveis (o mês atual já foi gerado), o Painel mostra os recorrentes ativos ainda não gerados, calculados na hora (`forecastRecurring` em `src/domain/recurrence.ts`, nada gravado), com selo "Previsto" e "Recorrente"; variável com valor "a definir". Fora do saldo; o cartão mostra "Previsto em recorrentes" (só fixos). A previsão **não** estende o limite de navegação.
- Pendências: "Recorrentes para confirmar" (variáveis aguardando o seu valor e cadastros fixos do outro para aprovar).

### Mês (competência)

- Fecha só sem gastos `pending_approval`, `returned` ou `awaiting_confirmation`, e com o pagamento do acerto registrado (comprovante PIX ou "pago em dinheiro").
- Fecha só sem foto de comprovante pendente de envio (`receipt.type: 'photo'` com `photoUploaded: false`); a aprovação não depende da foto ter chegado.
- Só fecha mês passado ou atual, nunca futuro (as regras tratam mês futuro como aberto sem consultar o banco).
- Fechar e reabrir exigem conexão. Reabrir exige aprovação do outro membro.
- Gasto lançado com data de um mês fechado entra na competência do mês aberto, mantendo a `date` original.
- Gastos de mês fechado são imutáveis (garantir também nas regras do Firestore).

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
  recurringId?, installment?: { seriesId, index, count, firstMonth }
  createdBy, createdAt, updatedAt

groups/{groupId}/recurring/{recurringId}
  description, kind: 'fixed' | 'variable', amountCents?, dayOfMonth, payerUid, payerSharePct
  startMonth: 'YYYY-MM', endMonth?, active
  status: 'pending_approval' | 'approved' | 'returned', approval?, rejection?
  proposal?: { kind, amountCents?, payerUid, payerSharePct, at }   // reajuste aguardando aprovação
  lastGeneratedMonth?            // só a Function grava
  createdBy, createdAt, updatedAt
```

Fotos no Storage em `groups/{groupId}/receipts/{expenseId}.jpg`, comprimidas no aparelho antes do upload. As regras aceitam só membros do grupo, `image/jpeg` e menos de 5 MB.

Regras atuais (`firestore.rules` e `storage.rules`, testadas em `tests/emulators/`):
- `expenses`: só membros leem. Centavos inteiros, total > 0, pessoal ≤ total, pct inteiro 0..100, pagador membro, descrição 1..80, data até o fim do mês seguinte, competência coerente com a data e nunca em mês fechado.
- **Quem lança** (criar e editar): todos os campos e nenhum a mais, `createdBy` = quem cria, horários do servidor, `status` conforme a regra do comprovante e da edição (tabelas acima), sem `approval`/`rejection` (a edição apaga as anteriores); `recurringId` nunca na criação e inalterado na edição. Comprovante: foto no caminho do próprio gasto (não enviada na criação); QR com chave de 44 dígitos e modelo 65: de SP só `'pending'` com a URL canônica da própria chave, de outros estados só `'unchecked'` sem URL; ou mantido sem mudança na edição. O dígito verificador é conferido no app e na Function (as regras não calculam o módulo 11). Exceção estreita: a fila de fotos pode só virar `receipt.photoUploaded` para `true`, sem mexer no status.
- **Outro membro**: em `pending_approval` aprova (`→ confirmed`, `approval.byUid` = ele) ou recusa (`→ returned`, motivo opcional); em automático valida (grava `approval` sem mudar o status) ou contesta (`→ returned`, motivo obrigatório). Não toca em valores nem no comprovante.
- **Function `checkNfce`** (gatilho): consulta a SEFAZ quando o QR chega ao servidor; só grava `nfceStatus`/`nfceData`, nunca muda o status. Numa série, só a parcela 1 consulta e grava em todas. `resolveNfce` (callable) só pré-preenche o formulário.
- **Nova consulta** ("Tentar conferir de novo"): exceção estreita para quem lançou voltar uma NFC-e de SP `failed` para `pending`, sem mexer em mais nada (nem no status).
- **Parcelas**: exceção ao limite de datas só dentro de série válida: primeiro mês dentro do limite, competência = primeiro mês + índice − 1, id no padrão e, na criação, a parcela 1 da mesma série (mesmo número de parcelas e primeiro mês) existe no mesmo lote ou antes, do mesmo autor. Na edição, `installment`, valor, parte pessoal, data e competência não mudam. Mês futuro nunca é consultado como fechado (sem leitura), o que deixa um lote de 48 parcelas dentro do limite de leituras das regras; a Fase 6 não pode fechar mês futuro.
- `recurring`: só membros leem. Ainda não aprovado (novo, pendente, recusado): quem cadastrou grava variável `approved` e fixo `pending_approval`, sem `approval`/`proposal`; o outro aprova ou recusa. Já aprovado: quem cadastrou mantém status, aprovação e versão aprovada; o dinheiro só muda direto entre variáveis, senão vai em `proposal` (diferente da versão aprovada, valores válidos, `at` do servidor); o outro aprova (versão aprovada = `proposal`, nova `approval`) ou recusa (`proposal` some, versão aprovada intacta). Qualquer um desativa; só quem cadastrou exclui. `lastGeneratedMonth` só pelo Admin SDK.
- Exclusão: só quem lançou, nunca em mês fechado. `months`: só leitura (fechamento na Fase 6). Subcoleções sem regra própria ficam fechadas.
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
