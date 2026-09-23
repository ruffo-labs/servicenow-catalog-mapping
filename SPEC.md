# Especificação — ServiceNow Catalog Mapping Agent

Versão 1.2 · 2026-09-23
Status: **em produção**, validado contra duas instâncias

---

## 1. Problema

Catálogos de serviço do ServiceNow acumulam configuração espalhada por dez ou
mais tabelas: variáveis, variable sets, choices, UI policies com ações, client
scripts, user criteria, e o motor de atendimento (workflow legado, Flow Designer
ou trigger). Não existe visão consolidada de "o que este item faz".

Na instância mapeada, um único record producer podia ter 40 variáveis, 15 UI
policies com 60 ações, 10 client scripts e 4 flows — e nada disso visível junto.

Levantar isso à mão é inviável: 248 itens somaram 2.982 variáveis, 3.605 ações
de UI policy e 1.016 scripts distintos.

## 2. Objetivo

Produzir, a partir de uma query fornecida pelo usuário, **um JSON estruturado**
que descreva por completo cada item de catálogo e record producer selecionado —
incluindo o que o executa e o que os scripts fazem, em linguagem natural.

O JSON responde, por item:

- **como o item é** — variáveis, choices, UI policies, client scripts, sets
- **quem pode ver** — user criteria
- **o que roda quando ele é pedido** — workflow, Flow Designer, trigger, com
  grau de confiança e histórico real de execução
- **o que cerca a tabela destino** — notificações, SLA/OLA, reports, portais
- **quanto ele é usado** — chamados abertos em três janelas
- **se a IA consegue pedir por conversa** — avaliação contra os critérios de
  Conversational Catalog

### Não-objetivos

- Não modifica nada na instância (ver §4).
- Não substitui a documentação funcional do processo; descreve a configuração.
- Não faz análise de código para correção — embora a leitura dos scripts revele
  problemas, que são registrados em `docs/findings.md` como subproduto.

## 3. Usuários e uso

| Quem | Como usa |
|---|---|
| Analista de sustentação | levanta um catálogo antes de mexer nele |
| Arquiteto | entende o acoplamento entre itens, flows e Script Includes |
| Auditoria / governança | vê quem tem acesso a quê (user criteria) e o que roda |
| Quem prioriza refatoração | ordena por `volume` e vê o que trava o conversacional |
| Outro agente | consome o JSON como contexto de um item |

O agente é operado em conversa: o usuário passa uma query, confere a lista de
itens, aprova, e recebe o JSON.

## 4. Requisitos não-funcionais (invioláveis)

### RNF-1 — Somente leitura

O agente **nunca** modifica a instância. Existe outro agente para alterações.

Aplicado em três camadas:

1. **Código** — `src/snClient.js` tem allowlist `['GET','HEAD']`. Qualquer outro
   método lança `ReadOnlyViolationError` antes da requisição sair. Sem flag de
   bypass, por decisão de projeto.
2. **Instância** — o usuário de integração deve ter `snc_read_only`, para que o
   próprio ServiceNow recuse escrita mesmo diante de um bug aqui.
3. **Teste** — `test-connection` tenta POST/PUT/PATCH/DELETE e falha se algum
   passar.

Única exceção: `POST /oauth_token.do` quando `SN_AUTH_TYPE=oauth`. É o protocolo
OAuth, não toca em registro, e está isolado no método de autenticação. Com
`basic` (padrão) nem isso existe.

### RNF-2 — Query obrigatória e confirmação

Nunca varrer a `sc_cat_item`. `active=true` sozinho não conta como filtro; o
`extract.js` recusa e sai com código 1.

Fluxo: preview sem `--confirm` → usuário confere → `--confirm`. Acima de 40
itens o preview vira resumo por tabela destino e a lista completa vai para
arquivo, porque parede de 500 linhas ninguém confere.

### RNF-3 — Custo previsível

A fase de extração não consome token. O custo de LLM é medido e informado
**antes** de ser gasto: a fase 1 imprime quantos scripts únicos restam e a
estimativa de tokens.

### RNF-4 — Retomável

Interromper no meio não perde trabalho. O cache por hash de conteúdo é o estado
do progresso.

### RNF-5 — Segurança de credencial

Credenciais só em `.env`, fora do git. O agente não as imprime nem as envia a
lugar nenhum além da própria instância.

## 5. Arquitetura

Quatro passos; só a fase 2 consome token.

```
  ┌──────────────── FASE 1 — Node puro, 0 token ─────────────────┐
  │ preview  →  [confirmação humana]  →  coleta                  │
  │ --volume: chamados por item (Aggregate API)                  │
  └──────────────────────────────────────────────────────────────┘
        ↓  catalog-map_<carimbo>.json  +  _scripts-pending_<carimbo>.json

  ┌───────── RELACIONADOS — da tabela destino, 0 token ──────────┐
  │ extract-related: notificações, SLA/OLA, reports, portais     │
  └──────────────────────────────────────────────────────────────┘
        ↓  related-map_<carimbo>.json  +  _related-scripts-pending_<carimbo>.json

  ┌───────────── FASE 2 — LLM, em lotes retomáveis ──────────────┐
  │ next-batch  →  explicar  →  merge-understandings             │
  │ repete até a fila zerar; o cache é o progresso               │
  └──────────────────────────────────────────────────────────────┘
        ↓  os dois JSONs acima, agora com script_understanding

  ┌─────────────── OPCIONAL — tudo num arquivo só ───────────────┐
  │ merge-related: grava um TERCEIRO arquivo;                    │
  │ as duas entradas ficam intactas                              │
  └──────────────────────────────────────────────────────────────┘
        ↓  catalog-map-completo_<carimbo>.json
```

A ordem entre `extract-related` e `merge-understandings` não é livre: o
primeiro regrava o `related-map.json` com os scripts em branco. Invertê-los
deixa as condições avançadas das notificações nulas no arquivo final.

### Camadas

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Config | `src/config.js` | lê e valida `.env`, sem dependência externa |
| HTTP | `src/snClient.js` | GET-only, retry com backoff, `Retry-After`, contador |
| API | `src/tableApi.js` | query, paginação, contagem, agregação, limite de URL |
| Arquivos | `src/outFiles.js` | nomes com carimbo, resolução da rodada mais recente e do par da mesma rodada |
| Campos | `src/catalog/fields.js` | listas de campos por tabela |
| Coleta | `src/catalog/collect.js` | preview, coleta em lote, hierarquia de tabelas |
| Forma | `src/catalog/shape.js` | conversão para o contrato de saída |
| Montagem | `src/catalog/build.js` | JSON final, dedupe de script, cache de dicionário |
| Fulfillment | `src/catalog/fulfillment.js` | workflows, flows, triggers, execução real |
| Relacionados | `src/catalog/related.js` | notificações, SLA/OLA, reports e portais da tabela destino |
| Volume | `src/catalog/volume.js` | chamados por item, contagem exata em 3 janelas |
| Conversacional | `src/catalog/conversational.js` | avaliação de item conversacional (VA / Now Assist) |

A troca da Table API por MCP, quando acontecer, é isolada em `snClient.js`.

## 6. Modelo de dados de origem

`sc_cat_item` é a tabela de descoberta — traz itens de catálogo **e** record
producers; `sys_class_name` separa. Record producer é relido na classe filha
`sc_cat_item_producer`, que devolve base + `table_name`, `redirect_url`, `view`
e os três scripts.

| Informação | Tabela |
|---|---|
| Variáveis | `item_option_new` |
| Variable sets | `item_option_new_set` + m2m `io_set_item` |
| Choices | `question_choice` |
| UI policies | `catalog_ui_policy` + `catalog_ui_policy_action` |
| Client scripts | `catalog_script_client` |
| User criteria | `sc_cat_item_user_criteria_mtom` / `..._no_mtom` |
| Workflow legado | `sc_cat_item.workflow` → `wf_workflow_version` (published) |
| Flow Designer | `sc_cat_item.flow_designer_flow` → `sys_hub_flow_base` |
| Trigger | `sys_hub_trigger_instance` + `sys_variable_value` |
| Execução real | `sys_flow_context` / `wf_context` |
| Notificações | `sysevent_email_action` (por `collection`) |
| SLA e OLA | `contract_sla` (por `collection`; `type` separa) |
| Reports | `sys_report` (por `table`) + `sys_report_users_groups` |
| Portais | `sp_portal` via m2m `m2m_sp_portal_catalog` — **não** tem campo de tabela |
| Volume de chamados | tabela destino, pelo campo de volta (`task.x_nasm_hr_item`) |
| Conversacional | `sc_cat_item.make_item_non_conversational`, `item_option_new.conversational_label` e afins |

Detalhe completo em `docs/fulfillment.md` e `docs/table-api.md`.

## 7. Contrato de saída

Três coleções no topo; variable sets e user criteria normalizados (aparecem uma
vez, mesmo compartilhados):

```json
{ "itens": [...], "variable_sets": [...], "user_criteria": [...] }
```

Os objetos que pertencem à **tabela destino** — notificações, SLA/OLA, reports
e portais — saem num arquivo irmão, `related-map.json`, pela mesma razão de
normalização: um SLA vale para todos os itens que caem naquela tabela. Ver
`docs/related-objects.md`.

Dentro de cada item, além das sub-coleções, há dois blocos que não são cópia de
campo:

| Bloco | O que é | Quando existe |
|---|---|---|
| `volume` | chamados já abertos: `total`, `last_12m`, `last_90d`, `rank`, `share_pct` | só com `--volume` |
| `conversational` | o item serve para a IA pedir: `veredito`, `bloqueadores[]`, `avisos[]` | sempre |

O `conversational` separa `declarado_na_instancia` (fato, do registro) do
`veredito` (regra aplicada sobre critérios publicados pela ServiceNow) — é a
mesma disciplina do `link` do fulfillment: **dizer o grau de confiança**. Ver
`docs/conversational.md`.

Formato dos valores (estilo export XML):

| Situação | Representação |
|---|---|
| Escalar | string — inclusive booleano e número |
| Referência preenchida | `{ "_display_value": "...", "__text": "<sys_id>" }` |
| Referência vazia | `""` |
| Glide List, 1 valor | objeto de referência |
| Glide List, N valores | `"Nome A, Nome B"` |
| Script | `{ "script_understanding": "..." }` ou `""` |

Especificação campo a campo em `docs/output-schema.md`.

### Grau de confiança do fulfillment

Cada entrada traz `link`:

| Valor | Significa | Confiança |
|---|---|---|
| `item_field` | veio do campo do próprio item | certeza |
| `trigger_condition` | a condição da trigger cita o sys_id do item | certeza |
| `target_table` | dispara na tabela destino | **candidato** |

E `executions` com `scope`: `item` (registros daquele item, amostrados) ou
`table` (a tabela toda, contagem exata).

**`active=true` com `count=0` não prova que o flow não roda** — o
`sys_flow_context` é podado. Ausência de evidência não é evidência de ausência.

## 8. Decisões de projeto

| Decisão | Razão |
|---|---|
| Table API direta, não MCP | MCP nativo depende de versão/licença; servidores de terceiros teriam acesso à credencial. Isolado para troca futura |
| Sem dependências npm | menos superfície, e o projeto lida com credencial de produção |
| Script cru fora do JSON | é levantamento, não versionamento de código |
| Dedupe exato por conteúdo | normalizar mais troca token por precisão (medido: ganho de 4%, risco de agrupar regras diferentes) |
| Paginação por keyset | offset degrada; exceção para `^NQ`, que quebra o cursor |
| Amostragem no runtime | um producer tinha 11.553 registros; varrer é inviável |
| Business rules fora | volume vira ruído sem critério |
| Fase 2 em lotes | 951 scripts não cabem numa passada |
| Relacionados em arquivo irmão | um SLA vale para os 148 itens da tabela; repetir dentro de cada item seria duplicar. `merge-related` junta quando se quer um arquivo só |
| Corpo do e-mail fora do mapeamento | 388 KB de template; o que importa é quando dispara, para quem e sob que condição (decisão do usuário) |
| Recorte dos relacionados sobe para as tabelas de tarefa | o SLA mede o caso, o OLA mede a tarefa: sem elas a coleção de OLA sai vazia |
| Conversacional é avaliação, não campo | os campos existem e estão vazios em 759 de 759 itens; o valor está em aplicar os critérios publicados |
| Volume em três janelas | o acumulado engana: um item com 39.283 no total tem 1.027 nos últimos 12 meses |
| Saída carimbada com data/hora | nunca sobrescrever levantamento anterior. `-` no lugar de `:` porque dois-pontos é proibido em nome de arquivo no Windows |

## 9. Armadilhas conhecidas do ServiceNow

Descobertas em produção, todas documentadas e tratadas:

| Armadilha | Efeito se ignorada |
|---|---|
| **Herança de tabela** no `sys_dictionary` | busca volta vazia e o código segue. Causou 3 bugs, um deles reportando 0 execuções onde havia 92.540 registros |
| **`^NQ` quebra o keyset** | loop infinito martelando a instância |
| **Limite de URL ~2048** | erro 400 com mensagem enganosa (`Pagination not supported`) |
| **`sys_hub_flow_snapshot`** | metade das entradas sem `active`, flow duplicado |
| **ACL silenciosa** | itens somem do resultado sem erro |
| **`^OR` agrupa com a condição anterior** | filtro vale menos do que parece |
| **`wf_workflow` sem dados** | table/condition estão na versão publicada |
| **`sp_portal` usa `inactive`** | portal ativo parece desligado |
| **`sys_report` não tem `group_by`/`order_by`/`chart_type`** | campo inventado sai vazio e ninguém percebe |
| **`sys_report.user` é string com `GLOBAL`/`group`, não referência** | tratar como Glide List produz referência falsa |
| **`sp_portal.sc_catalog` é só o catálogo padrão** | usar só ele devolve zero portal (4 de 42 preenchidos) |

Detalhe em `docs/table-api.md` e `docs/fulfillment.md`.

## 10. Métricas de referência

Levantamento de 248 record producers (`instancenaturasnqa`, 5 tabelas destino):

| | |
|---|---|
| Fase 1 | 1.018 chamadas, ~3 min, **0 token** |
| Variáveis (item / set) | 2.982 / 934 |
| Variable sets / user criteria | 150 / 105 |
| UI policies / ações | 1.761 / 3.605 |
| Client scripts | 986 |
| Scripts: ocorrências → únicos | 1.291 → 1.016 (**-21%** por dedupe) |
| Fase 2, primeira vez | ~186k tokens, ~20 lotes |
| Fase 2, re-execução | ~437 tokens (1.012 de cache) |
| Fulfillment | 691 entradas, 386 com execução confirmada |
| JSON final | 17,6 MB |
| Notificações / SLA / OLA / reports / portais | 467 / 454 / 404 / 650 / 2 |
| Relacionados: fase 1 | 187 chamadas, **0 token**, JSON de 4,4 MB |
| Chamados abertos no recorte | 647.511 — top 10 concentra 49,1%; 29 itens com zero |
| Conversacional | 30 aptos, 153 com ressalvas, 65 bloqueados |
| JSON com tudo junto (`merge-related`) | 23,4 MB |

Regra de orçamento: ~3 scripts únicos por item, ~190 tokens por script. Varia
muito por catálogo — sempre rode a fase 1 antes de decidir.

## 11. Fora de escopo hoje

| Item | Situação |
|---|---|
| Business rules no fulfillment | decisão do usuário; reavaliar se fizer falta |
| Catalog items sem producer | mapeados, mas nesta instância 489 de 490 não têm fulfillment rastreável |
| MCP como transporte | adiado; cliente isolado para a troca |
| Truncar scripts longos na fila | medido: economia de 15k de 144k. Não implementado |
| Ordenar lote por nome | 176 scripts em 61 famílias. Uma linha de código |
| Detectar script 100% comentado | achamos um de 8,8 KB; hoje é explicado à toa |
| Corpo do e-mail das notificações | fora por decisão do usuário; 388 KB, 362 distintos, ~99k tokens se um dia entrar |
| Itens ativos de fora do recorte | 3 deles têm volume nas mesmas tabelas, um com 7.818 chamados. Registrado em `docs/findings.md`, não mapeado |
| Conversacional: teste real no VA | a avaliação é estática; ninguém executou o item no Virtual Agent para confirmar |

## 12. Como evoluir com segurança

- **Não adicione método de escrita ao cliente HTTP.** Se for preciso escrever, é
  outro projeto.
- **Rode `node scripts/selftest.js`** depois de mexer em `shape.js`, `build.js`
  ou `fields.js`. Ele valida a transformação sem rede, inclusive que o script
  cru não vaza para o JSON.
- **Ao adicionar campo**, inclua na lista de `fields.js` e rode o `extract` uma
  vez: a validação contra o `sys_dictionary` avisa se o campo não existe naquela
  instância, em vez de sair um JSON com valor vazio.
- **Ao mexer em paginação ou lotes**, lembre do limite de URL: o tamanho é
  calculado por `maxIdsPerQuery`, não fixo.
- **Ao mudar o contrato**, atualize `docs/output-schema.md` junto — é o
  documento que outro agente lê para saber o que produzir.

- **Ao mexer no conversacional**, releia as duas páginas da ServiceNow citadas
  em `docs/conversational.md` antes de tocar em `TIPO_BLOQUEIA`/`TIPO_RESSALVA`,
  e confirme o mapa numérico de `type` na instância. Critério de produto muda.
- **Ao medir volume numa instância nova**, não presuma o campo de volta: ele é
  descoberto pela hierarquia e pode estar na tabela pai. Confira o
  `source_field` que saiu no JSON contra um `count` direto.