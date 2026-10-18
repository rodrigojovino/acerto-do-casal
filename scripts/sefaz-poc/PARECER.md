# Prova de conceito: NFC-e da SEFAZ-SP

> **Atualização (2026-10-17, Fase 4): confirmado na nuvem.** A consulta feita por uma Cloud Function em `southamerica-east1` (IP do Google) leu e conferiu com a chave **6 de 6 notas reais**, de 3 emissores, emitidas entre junho e outubro de 2026: HTTP 200, de 33 a 139 ms, sem captcha nem bloqueio. A amostra inclui uma nota **com desconto** (o valor lido é o "Valor a pagar", já descontado) e uma com **QR Code versão 3** (`chave|3|ambiente`, sem hash). Nenhuma passou de R$ 1.000; o separador de milhar fica coberto pelos testes de `functions/src/nfce.spec.ts`. O parser agora vive em `functions/src/nfce.ts`; a Function de teste foi apagada.

**Parecer: viável com limitações.** A consulta pública da SEFAZ-SP devolve valor total, data/hora de emissão e emitente sem captcha. Isso basta para usar o QR como fonte do valor. A extração depende do HTML da página, então o plano B (valor digitado) continua como alternativa automática quando a leitura falhar.

Teste feito em 2026-10-17, a partir de uma conexão residencial no Brasil, com 2 NFC-e reais de SP emitidas por estabelecimentos diferentes em 2026. As URLs não foram versionadas.

## Como rodar

```powershell
node scripts/sefaz-poc/sefaz-poc.ts "<url do QR>"
# ou, com várias URLs num arquivo ignorado pelo git:
node scripts/sefaz-poc/sefaz-poc.ts --file scripts/sefaz-poc/urls.local.txt
```

Requer Node 24+, que executa TypeScript nativamente. O script não usa dependências.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Notas lidas | 2/2 (emitente, CNPJ, valor total e data/hora extraídos) |
| Captcha | nenhum |
| Sessão, viewstate ou cookie prévio | não precisa: um GET direto na URL do QR já devolve a nota |
| User-Agent de navegador | não precisa |
| Tempo de resposta | 80 a 300 ms |
| CNPJ e mês de emissão contra a chave de acesso | conferem nas 2 notas |
| QR com hash adulterado | rejeitado; a SEFAZ responde "Hash QR Code inválido" e o script detecta |
| CORS (`Access-Control-Allow-Origin`) | ausente |

O que vem de onde:

- **Do próprio QR, sem rede:** chave de acesso, que traz UF, ano/mês, CNPJ do emitente, modelo, série e número. Num QR de contingência offline (8 campos no parâmetro `p`), vêm também o dia e o valor total. Nas notas testadas (emissão normal), o QR **não** traz valor nem dia.
- **Só da consulta:** razão social do emitente, valor total ("Valor a pagar", já com descontos), data e hora de emissão. Também os itens, que o MVP não usa.

## Limitações

1. **Dependência do HTML.** Os campos são extraídos por âncoras da página: `#u20` (emitente), `span.totalNumb.txtMax` (valor) e o rótulo "Emissão:". A página informa "Versão XSLT: 2.05". Uma mudança de layout da SEFAZ quebra a extração sem aviso. Mitigação: validar o resultado contra a chave (CNPJ e mês), como o script já faz, e cair no plano B quando algo não bater.
2. **Precisa de servidor.** Sem CORS, o navegador bloqueia a consulta feita direto da versão web. No Android daria para usar o HTTP nativo do Capacitor, mas centralizar no servidor permite corrigir o parser sem publicar novo APK.
3. ~~IP de datacenter não testado.~~ Testado na Fase 4: funciona a partir de `southamerica-east1`. O firewall da SEFAZ (cookies `TS…`) ainda pode mudar de comportamento com volume; o uso de um casal é de poucas consultas por dia.
4. **Só SP.** Outras UFs têm portais e layouts próprios. Uma nota de fora de SP (UF da chave ≠ 35) vai direto para o plano B.
5. **Amostra ainda pequena.** São 6 notas de 3 emissores, uma com desconto. O plano B cobre o que não for lido.

## Recomendação para a Fase 4

- **Cloud Function callable** `resolveNfce` em `southamerica-east1`. Ela recebe a URL do QR, valida a chave, consulta a SEFAZ, extrai os campos e grava no gasto: `receipt.nfceStatus` vira `'ok'` com valor, data e emitente, ou `'failed'`.
- **No aparelho, sem rede:** decodificar a chave na hora (mês e CNPJ) e salvar o gasto com `nfceStatus: 'pending'`. A consulta acontece quando a conexão volta, como já prevê o `CLAUDE.md`.
- **Plano B automático:** em `'failed'` (layout mudou, nota de outra UF, bloqueio), o usuário digita o valor e o QR continua valendo como comprovante.
- **Rejeitar no app** um QR com hash inválido: a SEFAZ diz que a nota não é autêntica, então ele não vale como comprovante.
- Mover para `src/domain/` e cobrir com testes as funções puras do script: decodificação da chave, dígito verificador e conversão de "1.234,56" para centavos. Os testes devem usar chaves fictícias.
