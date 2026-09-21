# ServiceNow Catalog Mapping Agent

Agente de **mapeamento** (documentação) de itens de catálogo e record producers
de uma instância ServiceNow. A saída é um JSON estruturado por item.

**Novo por aqui?** Leia o `README.md` (índice) e o `SPEC.md` (o projeto inteiro).
Para rodar: `docs/runbook.md`. Custo em token: `docs/token-economics.md`.
Problemas achados no catálogo mapeado: `docs/findings.md`.

---

## ⛔ DIRETRIZ #1 — SOMENTE LEITURA (NÃO NEGOCIÁVEL)

**Este agente NUNCA modifica nada na instância ServiceNow.**

Existe outro agente, separado, responsável por alterações. Este aqui é de
consulta e só de consulta.

Proibido, sem exceção e sem "só dessa vez":

- `POST`, `PUT`, `PATCH`, `DELETE` em qualquer endpoint da instância
- Criar, atualizar, deletar ou desativar qualquer registro
- Import Sets, Attachment API de upload, Batch API com operações de escrita
- Executar script server-side (`/sys.scripts.do`, Background Scripts, Fix Scripts)
- Mexer em Update Sets, publicar apps, mover/exportar XML de volta pra instância
- Qualquer Scripted REST endpoint cujo efeito colateral seja escrita

Permitido:

- `GET` na Table API (`/api/now/table/...`)
- `GET` na Aggregate API (`/api/now/stats/...`) para contagens
- `GET` de metadados (`sys_dictionary`, `sys_choice`, `sys_db_object`)
- Escrita **apenas no sistema de arquivos local** (os JSONs de saída)

### Como a regra é aplicada

1. **No código** — `src/snClient.js` tem um allowlist de métodos HTTP
   (`GET`, `HEAD`). Qualquer outro método lança `ReadOnlyViolationError`
   antes de a requisição sair. Não existe flag, env var ou parâmetro que
   desligue isso. Se algum dia for preciso escrever, é outro projeto.
2. **Na instância** — o usuário de integração DEVE ter a role `snc_read_only`
   (ou equivalente). Isso faz o próprio ServiceNow recusar escrita para essa
   credencial, então mesmo um bug aqui não causa dano. Defesa em profundidade.
3. **Na revisão** — qualquer PR que adicione método de escrita ao cliente HTTP
   é rejeitado por definição.

Se o usuário pedir uma alteração na instância: **recuse e aponte para o outro
agente**. Não improvise, não peça confirmação para fazer mesmo assim.

---

## ⛔ DIRETRIZ #2 — QUERY OBRIGATÓRIA E CONFIRMAÇÃO ANTES DE MAPEAR

**Nunca varrer a `sc_cat_item` inteira.** O usuário sempre fornece a query.
`active=true` sozinho não conta como filtro — `scripts/extract.js` recusa e sai
com código 1.

**Fluxo obrigatório, nesta ordem:**

1. Rodar `extract.js --query "<query do usuário>"` **sem** `--confirm`. Ele
   lista quantos são, quais são (nome), se cada um é **Catalog Item** ou
   **Record Producer**, e a tabela destino dos producers.
   Acima de 40 itens a saída vira um resumo agrupado por tabela destino e a
   lista completa vai para `out/_preview.txt` — parede de 500 linhas no
   terminal ninguém confere, e conferir é o ponto deste passo.
2. Mostrar essa lista ao usuário e **perguntar se são esses mesmos** que ele
   quer mapear.
3. Só depois do "sim" rodar de novo com `--confirm`.

Não pular o passo 2, nem quando a lista tiver um item só.

### Onde ler cada tipo

A `sc_cat_item` é a tabela de descoberta — ela traz itens de catálogo **e**
record producers, e é o `sys_class_name` que separa. Depois de identificar:

- **Catalog Item** → permanece lido da `sc_cat_item`
- **Record Producer** → relido na `sc_cat_item_producer`, que por ser classe
  filha devolve os campos da base **mais** `table_name`, `redirect_url`, `view`
  e os três scripts (`script`, `post_insert_script`, `save_script`)

---

## ⛔ DIRETRIZ #3 — FASE 2: EXPLICAR, NÃO COPIAR

O script cru **nunca** entra no JSON final. Isto é levantamento, não backup de
código. O que vai é a explicação em prosa no `script_understanding`.

**Onde parar:** se o script chama outro (GlideAjax, Script Include, subflow),
registre **que** chama, o nome do método e **o que faz com o retorno**. Não saia
lendo o outro script. Isso vale para todos os tipos — client script, script de
record producer, user criteria.

Regras completas e exemplos: `docs/script-understanding.md`.

---

## Orientações de trabalho (decisões tomadas com o usuário)

Estas não são preferências minhas — foram acordadas durante o projeto e valem
até o usuário dizer o contrário.

### Escopo do mapeamento

- **Business rules ficam de fora** do fulfillment. Uma tabela como `incident`
  tem ~48 ativas; o volume vira ruído sem critério.
- **Variable sets e user criteria**: só os **usados** pelos itens filtrados,
  deduplicados e normalizados no topo do JSON.
- **`question_choices`**: mapeadas sempre que existirem choices cadastradas,
  **independente do `type`** da variável — há variável string com choice
  cadastrada na mão. Quando não houver, a origem das opções fica registrada em
  `choice_table`/`choice_field`/`lookup_*`.
- **Record producer**: os três scripts (`script`, `post_insert_script`,
  `save_script`) viram `script_understanding`.

### Levantamentos grandes

Acima de ~50 itens, **fatie por catálogo** e entregue em pedaços. O usuário
revisa enquanto o resto roda, e se as explicações precisarem de ajuste você
corrige antes de gastar o resto. Fatiar não custa nada a mais — o cache é global
e por hash. No fim, rode a query completa para o consolidado (sai por ~0 token).

### Como reportar

- **Meça antes de recomendar.** Não afirme ganho de performance ou de token sem
  número medido. Já aconteceu de a hipótese estar errada (normalizar o hash
  parecia valer 30%, mediu 2,8%) — registre o resultado negativo para ninguém
  refazer o teste.
- **Aponte o próprio erro.** Vários bugs deste projeto só apareceram em escala e
  foram achados por estranhar o número, não por teste. Se um resultado parece
  bom demais ou vazio demais, investigue antes de entregar.
- **Nunca chute o que a instância pode responder.** Mapa de `type`, nomes de
  campo, motor de fulfillment: tudo se lê do `sys_dictionary`/`sys_choice`. A
  memória do modelo já errou aqui (`redirect_to`/`view_id` não existem;
  `20` é Container End, não List Collector).
- **Diga o grau de confiança.** No JSON isso é o campo `link`; no texto, é
  separar "confirmado por execução" de "candidato".

## Modelo de dados do catálogo

`sc_cat_item` é a tabela base. Record Producer é **classe filha**, não tabela
paralela — o `sys_class_name` distingue.

| O quê | Tabela |
|---|---|
| Item de catálogo (base) | `sc_cat_item` |
| Record Producer | `sc_cat_item_producer` (extends `sc_cat_item`) |
| Outras classes filhas | `sc_cat_item_content`, `sc_cat_item_order_guide`, `sc_cat_item_wizard`, `pc_*_cat_item` |
| Variáveis | `item_option_new` |
| Variable Sets | `item_option_new_set` + m2m `io_set_item` |
| Choices de variável | `question_choice` (por `question` = sys_id da variável) |
| Catalog UI Policies | `catalog_ui_policy` + `catalog_ui_policy_action` |
| Catalog Client Scripts | `catalog_script_client` |
| Catálogos / Categorias | `sc_catalog`, `sc_category` + m2m `sc_cat_item_catalog`, `sc_cat_item_category` |
| User Criteria | `sc_cat_item_user_criteria_mtom` (available) / `sc_cat_item_user_criteria_no_mtom` (not available) |
| Fulfillment | três caminhos distintos — ver `docs/fulfillment.md` |

Campos exclusivos de Record Producer: `table_name`, `redirect_url`, `view`,
`script`, `post_insert_script`, `save_script`. Não existem `redirect_to` nem
`view_id`. O mapeamento variável → coluna usa `item_option_new.map_to_field`
combinado com o `name` da variável.

**A confirmar na instância (não chutar de memória):**
- mapa numérico de `item_option_new.type` → está em `sys_choice` da tabela
  **`question`** (herança), não em `item_option_new`
- qual dos três caminhos de fulfillment a instância usa

## ⚠ Regra de herança de tabela (já causou 3 bugs)

**Nunca consultar `sys_dictionary` com `name=<tabela>` sozinho.** Sempre subir a
cadeia de herança com `tableHierarchy()` e usar `nameIN<cadeia>`.

Casos que já morderam neste projeto:

| Procurado em | Está na verdade em |
|---|---|
| `item_option_new.type` | `question.type` |
| `sys_hub_flow` (pela trigger) | `sys_hub_flow_base` (inclui snapshots) |
| campo de volta de `x_nasm_rtr_case` | `task.x_nasm_hr_item` |

O terceiro fez o mapeamento reportar **0 execuções** onde havia 92.540
registros. Falha silenciosa: a busca volta vazia e o código segue.

## Fulfillment (flows e workflows)

Três caminhos, documentados com as tabelas todas em `docs/fulfillment.md`:

1. `sc_cat_item.workflow` → `wf_workflow_version` (published) — workflow legado
2. `sc_cat_item.flow_designer_flow` → `sys_hub_flow_base`
3. **trigger cuja condição cita o sys_id do item** — o caso dos record producers;
   busca em `sys_variable_value` (`document=sys_hub_trigger_instance^valueLIKE<id>`)

Sai no JSON como `triggered_workflows[]` e `triggered_flow_designers[]`, cada
entrada com `link` (grau de confiança) e `executions` (o que rodou de verdade,
de `sys_flow_context` / `wf_context`).

Quando nenhum dos três acha nada e o item tem `table_name`, entra o fallback
automático: lista o que dispara na tabela destino como `link: "target_table"`
(candidato, não certeza).

Armadilhas já tratadas: ler de `sys_hub_flow_base` e não `sys_hub_flow`
(existem snapshots); deduplicar por nome+condição+gatilho; buscar o campo de
volta na hierarquia inteira; e nunca varrer os registros da tabela destino —
amostrar os N mais recentes (`--runtime N`).

## Paginação

`TableApi.iterate` usa keyset (`sys_id>cursor`), que só é válido quando a
query é uma conjunção única. **Query com `^NQ` cai automaticamente para
offset** — com grupos independentes o cursor gruda só no último e a paginação
entra em loop infinito. Há trava anti-loop para o resto. Ver `docs/table-api.md`.

## Conexão

Table API via REST, sem MCP por enquanto (MCP fica para uma fase posterior —
o cliente está isolado em `src/snClient.js` justamente para essa troca ser barata).

Credenciais em `.env` (fora do git). Ver `.env.example`.

## Pipeline

Duas fases. A primeira é extração pura; a segunda é o LLM explicando scripts.

```bash
# fase 1 — extração (0 tokens). --runtime confirma fulfillment com execução real
node scripts/extract.js --query "<query>" --confirm --runtime 50

# fase 2 — em LOTES RETOMÁVEIS. Repetir até acabar.
node scripts/next-batch.js --size 50     # corta o próximo lote
#   -> explicar out/_scripts-batch.json conforme docs/script-understanding.md
#   -> escrever out/_scripts-understood.json  { "<hash>": "explicacao" }
node scripts/merge-understandings.js     # injeta no JSON e grava no cache
```

**Nunca tentar a fase 2 numa passada só.** Medido em 151 record producers: 462
scripts únicos, ~94k tokens de entrada. O ciclo em lotes é retomável — o cache
`.cache/script-understandings.json` é o estado do progresso, então parar no meio
não perde nada. A fila é deduplicada por hash; script repetido ou já explicado
numa rodada anterior não volta para o LLM.

O dicionário da instância fica em cache por 7 dias em
`.cache/dictionary-<host>.json` — são 58 chamadas fixas que só valem na primeira
execução (78 → 20 chamadas na segunda). Use `--refresh-dict` depois de qualquer
mudança de estrutura na instância.

Regras de como explicar script (incluindo onde parar numa chamada GlideAjax):
`docs/script-understanding.md`. Contrato de saída: `docs/output-schema.md`.

O filtro é **pedido a quem executa** — catálogo, categoria, nome, sys_id, tipo,
ativo/inativo, atualizado depois de. Nunca rodar sem filtro sem confirmar antes.

## Economia de token (medido, não estimado)

**Fase 1 custa ZERO token** — é Node puro. Quantidade de chamadas HTTP não tem
relação nenhuma com custo em token; batelada existe por tempo de parede, não
por economia.

O que dirige o custo é **quantos scripts distintos** entram no recorte, não
quantos itens. Rode sempre a fase 1 primeiro: ela dá o número exato de graça.

| Mecanismo | Economia medida |
|---|---|
| Dedupe por hash de conteúdo | 21% |
| Cache de explicações entre execuções | ~100% em re-execução |
| Cache de dicionário | 58 chamadas (não token) |

**Já testado e descartado:** normalizar espaços (2,8%) e dígitos (4,3%) antes
do hash. Não paga a complexidade, e o de dígitos troca token por precisão —
dois scripts que diferem num número podem diferir em regra de negócio.

**Vale implementar:** truncar os 15 scripts acima de 3.000 chars (economia de
15k de 144k) e ordenar o lote por `label` (176 scripts em 61 famílias de mesmo
nome — chegam juntos, explicação sai consistente). Detalhes e números em
`docs/token-economics.md`.

Ao ler um lote, fatie **sem sobreposição** (`slice(0,35)` depois `slice(35)`)
e trunque scripts longos. Reler o mesmo trecho é desperdício puro.

## Estrutura

```
src/config.js             # carrega e valida env
src/snClient.js           # camada HTTP — GET-only, retry, paginação
src/tableApi.js           # helpers de query sobre a Table API
src/catalog/fields.js     # listas de campos por tabela
src/catalog/collect.js    # coleta em lote + dicionário + filtro
src/catalog/shape.js      # conversão para o formato do contrato
src/catalog/build.js      # montagem do JSON final
scripts/test-connection.js
scripts/explore.js        # descobre catalogos/categorias para montar o filtro
src/catalog/fulfillment.js # flows, workflows e execução real
scripts/extract.js        # fase 1
scripts/next-batch.js     # fase 2 — corta o próximo lote
scripts/merge-understandings.js  # fase 2 — injeta e atualiza o cache
scripts/selftest.js       # testa a transformação sem rede
```

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `README.md` | porta de entrada, estado atual, índice |
| `SPEC.md` | especificação: problema, requisitos, arquitetura, decisões, métricas |
| `docs/runbook.md` | passo a passo de um levantamento + erros comuns |
| `docs/output-schema.md` | contrato do JSON, campo a campo |
| `docs/fulfillment.md` | flows, workflows, triggers e execução real |
| `docs/script-understanding.md` | como escrever as explicações |
| `docs/table-api.md` | Table API, paginação e armadilhas |
| `docs/token-economics.md` | custos medidos e o que otimizar |
| `docs/findings.md` | problemas achados no catálogo mapeado |
