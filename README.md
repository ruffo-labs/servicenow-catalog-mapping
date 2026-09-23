# ServiceNow Catalog Mapping Agent

Levanta e documenta itens de catálogo e record producers de uma instância
ServiceNow, produzindo um JSON estruturado por item.

Por item, o JSON responde:

| | |
|---|---|
| **Como o item é** | variáveis, choices, UI policies, client scripts, variable sets |
| **Quem pode ver** | user criteria |
| **O que roda quando é pedido** | workflow legado, Flow Designer e triggers, com grau de confiança e histórico real de execução |
| **O que cerca a tabela destino** | notificações, SLA/OLA, reports e portais |
| **Quanto é usado** | chamados abertos: total, 12 meses, 90 dias |
| **Se a IA consegue pedir** | avaliação contra os critérios de Conversational Catalog |

Os scripts não entram crus no JSON: um LLM lê cada um e grava uma explicação
em prosa (`script_understanding`).

---

## Comece por aqui

| Se você quer... | Leia |
|---|---|
| Entender o projeto por inteiro | [`SPEC.md`](SPEC.md) — problema, requisitos, arquitetura, decisões |
| Rodar um levantamento | [`docs/runbook.md`](docs/runbook.md) |
| Entender as regras invioláveis | [`CLAUDE.md`](CLAUDE.md) — DIRETRIZ #1 e #2 |
| Saber o formato do JSON | [`docs/output-schema.md`](docs/output-schema.md) |
| Entender flows e workflows | [`docs/fulfillment.md`](docs/fulfillment.md) |
| Mapear notificações, SLA/OLA, reports e portais | [`docs/related-objects.md`](docs/related-objects.md) |
| Saber se o item serve para a IA pedir | [`docs/conversational.md`](docs/conversational.md) |
| Escrever `script_understanding` | [`docs/script-understanding.md`](docs/script-understanding.md) |
| Saber quanto custa em token | [`docs/token-economics.md`](docs/token-economics.md) |
| Ver os problemas achados no catálogo | [`docs/findings.md`](docs/findings.md) |
| Entender a Table API e suas armadilhas | [`docs/table-api.md`](docs/table-api.md) |

## As duas regras que não se quebram

1. **Somente leitura.** O cliente HTTP só faz `GET`/`HEAD`. Qualquer outro
   método lança `ReadOnlyViolationError` antes de a requisição sair. Não há
   flag que desligue. Alterações na instância são de outro agente.
2. **Query obrigatória + confirmação.** Nunca varrer a `sc_cat_item`. O usuário
   fornece a query; o agente lista o que casou e **pergunta** antes de mapear.

Detalhes e justificativas em [`CLAUDE.md`](CLAUDE.md).

## Instalação

Não há dependências — só Node 20+.

```bash
cp .env.example .env     # preencher instância e credenciais
node scripts/test-connection.js
```

O `.env` está no `.gitignore`. Use um usuário de integração dedicado com a role
`snc_read_only`: assim o próprio ServiceNow recusa escrita para essa credencial,
e um bug aqui não causa dano.

## O fluxo

```
FASE 1 — extração (Node puro, ZERO token)
  preview  →  você confirma  →  coleta  →  catalog-map.json + fila de scripts
  com --volume, conta também os chamados abertos por item

RELACIONADOS — da tabela destino (ZERO token)
  extract-related  →  related-map.json  (notificações, SLA/OLA, reports, portais)

FASE 2 — explicação (LLM, em lotes retomáveis)
  next-batch  →  explicar  →  merge-understandings  →  repetir até acabar

OPCIONAL — tudo num arquivo só
  merge-related  →  catalog-map-completo_<carimbo>.json  (as entradas ficam intactas)
```

**Nenhum arquivo de `out/` é sobrescrito.** Cada execução carimba o nome com
a data e a hora (`catalog-map_2026-09-23_14-57-21.json`) e os comandos
seguintes acham sozinhos o mais recente.

O estado do progresso é o cache (`.cache/script-understandings.json`). Parar no
meio não perde nada; re-rodar um levantamento já feito custa ~0 token.

**A ordem entre `extract-related` e `merge-understandings` importa** — o
primeiro regrava o arquivo de relacionados com os scripts em branco. Passo a
passo completo em [`docs/runbook.md`](docs/runbook.md).

## Estrutura

```
src/
  config.js              carrega e valida .env (sem dependência externa)
  snClient.js            HTTP: GET-only, retry, backoff, contador de chamadas
  tableApi.js            query/iterate/count/groupCount + limite de URL
  outFiles.js            nomes com carimbo de data/hora e resolução da rodada mais recente
  catalog/
    fields.js            listas de campos por tabela
    collect.js           preview, coleta em lote, hierarquia de tabelas
    shape.js             conversão para o formato do contrato
    build.js             montagem do JSON + dedupe de scripts + cache de dicionário
    fulfillment.js       workflows, flows, triggers e execução real
    related.js           notificações, SLA/OLA, reports e portais da tabela destino
    volume.js            chamados por item, contagem exata em 3 janelas
    conversational.js    avaliação de item conversacional (VA / Now Assist)
scripts/
  test-connection.js     valida credencial, ACLs e descobre o mapa de type
  explore.js             lista catálogos/categorias para montar o filtro
  extract.js             FASE 1
  extract-related.js     objetos ligados à tabela destino (roda depois do extract)
  next-batch.js          FASE 2 — corta o próximo lote
  merge-understandings.js FASE 2 — injeta e atualiza o cache
  merge-related.js       junta o related-map dentro do catalog-map (um arquivo só)
  selftest.js            testa a transformação sem rede
docs/                    ver tabela acima
out/                     saída (gitignored)
.cache/                  dicionário e explicações de script (gitignored)
```

## Estado atual

Validado contra duas instâncias. Último levantamento completo:
**248 record producers** da `instancenaturasnqa`, em 5 tabelas destino.

| | |
|---|---|
| Variáveis (item / variable set) | 2.982 / 934 |
| Variable sets | 150 |
| User criteria únicos | 105 |
| UI policies / ações | 1.761 / 3.605 |
| Client scripts | 986 |
| Scripts explicados | 1.016 (0 pendências) |
| Fulfillment | 691 entradas, 386 com execução confirmada |
| Chamados abertos no recorte | 647.511 — top 10 concentra 49,1% |
| Conversacional (avaliação) | 30 aptos, 153 com ressalvas, 65 bloqueados |
| JSON final | 17,6 MB |
| Fase 1 | ~1.020 chamadas, ~3 min, **0 token** |
| Fase 2 (primeira vez) | ~186k tokens de entrada, em lotes |
| Fase 2 (re-execução) | ~0 token — tudo em cache |

Saída por fatia em `out/<catálogo>/` e o conjunto em `out/consolidado/`.

Objetos das tabelas destino (`related-map.json`, mesmo recorte):

| | |
|---|---|
| Notificações | 467 (410 ativas) |
| SLA / OLA | 454 / 404 |
| Reports | 650 (1.010 compartilhamentos) |
| Portais | 2 de 42 |
| Citam um item do levantamento | 201 notif., 486 SLA/OLA, 243 reports |
| Fase 1 | 187 chamadas, **0 token** · JSON de 4,4 MB |

## O que ainda não é feito

- **Business rules** não entram no fulfillment (decisão do usuário: volume vira
  ruído). Uma tabela como `incident` tem ~48 ativas.
- **Catalog items comuns** (não-producers) foram mapeados mas, nesta instância,
  praticamente não têm fulfillment rastreável — 489 de 490 itens ativos não
  usam nem `workflow` nem `flow_designer_flow`.
- **O corpo dos e-mails** de notificação fica fora do mapeamento, por decisão
  do usuário. São 388 KB de template; o que interessa é quando dispara, para
  quem vai e sob que condição.
- **O veredito conversacional não foi testado no Virtual Agent.** É avaliação
  estática contra critérios publicados — indica onde olhar, não certifica.
- **MCP**: a conexão é Table API direta. O cliente está isolado em
  `src/snClient.js` justamente para essa troca ser barata quando for a hora.
