# Contrato de saída (JSON)

> Derivado do exemplo fornecido em 2026-09-16. Todas as origens são leitura
> via Table API (`GET`). Ver DIRETRIZ #1 em `CLAUDE.md`.

## Formato dos valores

O exemplo usa o estilo de export XML da ServiceNow convertido para JSON:

| Situação | Representação |
|---|---|
| Campo escalar | string — `"active": "true"`, `"order": "20"` (tudo string, inclusive booleano e número) |
| Referência preenchida | `{ "_display_value": "Mobiles", "__text": "<sys_id>" }` |
| Referência vazia | `""` (string vazia, **não** `null` nem objeto vazio) |
| Glide List (multi-valor) | string de sys_ids separados por vírgula — ex.: `sc_catalogs` |

A Table API com `sysparm_display_value=all` devolve `{value, display_value}`
por campo, que é exatamente essa forma com outros nomes. O adaptador converte:

```
{value: "", display_value: ""}          -> ""
{value: "abc", display_value: "Mobiles"} -> {_display_value: "Mobiles", __text: "abc"}
```

## Estrutura

Três coleções no topo. Variable sets e user criteria são **normalizados**:
aparecem uma única vez no topo mesmo quando compartilhados por vários itens, e
os itens só guardam a referência.

```
{
  "itens":         [ ... ],   // sc_cat_item (+ classes filhas)
  "variable_sets": [ ... ],   // item_option_new_set, dedup
  "user_criteria": [ ... ]    // user_criteria, dedup
}
```

## `itens[]` — origem `sc_cat_item`

Record Producer é classe filha, então vem da mesma consulta; `sys_class_name`
distingue.

| Chave | Origem |
|---|---|
| `active`, `name`, `order`, `short_description`, `state`, `type` | colunas diretas de `sc_cat_item` |
| `sys_id`, `sys_class_name`, `sys_name` | idem (`sys_name` vem de `sys_metadata`) |
| `category` | `sc_cat_item.category` → `sc_category` |
| `sc_catalogs` | `sc_cat_item.sc_catalogs` — Glide List, vários catálogos vêm separados por vírgula |
| `flow_designer_flow` | `sc_cat_item.flow_designer_flow` → `sys_hub_flow` |
| `workflow` | `sc_cat_item.workflow` → `wf_workflow` |

### Sub-coleções do item

| Chave | Consulta |
|---|---|
| `catalog_variables[]` | `item_option_new?sysparm_query=cat_item=<id>^ORDERBYorder` |
| `catalog_variable_sets[]` | `io_set_item?sysparm_query=sc_cat_item=<id>` (só o vínculo; o set completo vai no topo) |
| `catalog_ui_policies[]` | `catalog_ui_policy?sysparm_query=catalog_item=<id>` |
| `catalog_ui_policies[].ui_policy_actions[]` | `catalog_ui_policy_action?sysparm_query=ui_policy=<policy_id>` |
| `catalog_client_script[]` | `catalog_script_client?sysparm_query=cat_item=<id>` |
| `triggered_workflows[]` | workflow legado — ver `docs/fulfillment.md` |
| `triggered_flow_designers[]` | Flow Designer e triggers — ver `docs/fulfillment.md` |

### Forma de uma entrada de fulfillment

```json
{
  "name": "EY: Reimbursement of Daycare or Babysitting Assistance",
  "sys_id": "...",
  "link": "trigger_condition",
  "active": "true",
  "status": "published",
  "trigger_type": "Criação em",
  "trigger_table": "x_nasm_hr_case",
  "trigger_condition": "item=f662d29e...",
  "run_trigger": "once",
  "executions": { "count": "4", "last": "...", "scope": "item", "sample_size": "50" }
}
```

`link` diz o grau de confiança: `item_field` e `trigger_condition` são certeza,
`target_table` é **candidato** (dispara na tabela, não necessariamente por causa
deste item).

`executions.scope` diz de quem é a contagem: `item` (registros daquele item,
amostrados — traz `sample_size`) ou `table` (a tabela toda, contagem exata via
Aggregate API). `executions` só existe quando o extract roda com `--runtime`.

Combinações e o que significam:

| `active` | `count` | Leitura |
|---|---|---|
| true | > 0 | roda, confirmado |
| false | 0 | carcaça: configurado e morto |
| true | 0 | configurado, sem execução **na amostra** — pode ser item pouco usado ou poda do `sys_flow_context`. **Não** concluir que não roda |
| `catalog_available_for[]` | `sc_cat_item_user_criteria_mtom?sysparm_query=sc_cat_item=<id>` |
| `catalog_not_available_for[]` | `sc_cat_item_user_criteria_no_mtom?sysparm_query=sc_cat_item=<id>` |

## `variable_sets[]` — origem `item_option_new_set`

Coletados a partir dos `io_set_item` dos itens selecionados, depois buscados
uma única vez.

| Chave | Consulta |
|---|---|
| `vs_variables[]` | `item_option_new?sysparm_query=variable_set=<set_id>^ORDERBYorder` |
| `vs_ui_policies[]` | `catalog_ui_policy?sysparm_query=variable_set=<set_id>` |
| `vs_ui_policies[].ui_policy_actions[]` | `catalog_ui_policy_action?sysparm_query=ui_policy=<policy_id>` |
| `vc_catalog_client_scripts[]` | `catalog_script_client?sysparm_query=variable_set=<set_id>` |

## `user_criteria[]` — origem `user_criteria`

Coletados dos `catalog_available_for` / `catalog_not_available_for`, dedup por
`sys_id`. Atenção: `role`, `user`, `group`, `company`, `department`, `location`
são **Glide Lists** na tabela `user_criteria` — podem ter vários valores.

## Enriquecimento por IA (não é extração)

`script` não sai como coluna: o exemplo pede um objeto

```json
"script": { "script_understanding": "explicação do que o script faz" }
```

Ou seja, o pipeline tem duas fases — **extrair** da Table API e depois
**resumir** o script com LLM. Ocorre em:

- `itens[].catalog_client_script[].script`
- `variable_sets[].vc_catalog_client_scripts[].script`
- `user_criteria[].script`

## Estratégia de coleta

Evitar N chamadas por item. Uma chamada por tabela dependente, com os sys_ids
em lote:

```
item_option_new?sysparm_query=cat_itemIN<id1>,<id2>,...,<id50>
```

Lotes de ~50 sys_ids (limite prático do tamanho da URL), depois agrupar em
memória por `cat_item`. Para N itens isso dá ~8 chamadas por lote em vez de 8N.

## Decisões fechadas (2026-09-16)

| Ponto | Decisão |
|---|---|
| Escopo de sets e user criteria | só os **usados** pelos itens filtrados, deduplicados |
| Record Producer | `table_name`, `redirect_url`, `view`; os três scripts (`script`, `post_insert_script`, `save_script`) viram `script_understanding` |
| `question_choices` | mapeadas **sempre que existirem choices cadastradas**, independente do `type` da variável (há variável string com choice cadastrada na mão) |
| Opções que não vêm de `question_choice` | variável carrega `choice_table`/`choice_field`/`choice_direction`/`include_none` (Select Box que puxa do dicionário da tabela destino) e `lookup_table`/`lookup_value`/`lookup_label`/`lookup_unique`/`lookup_dependent_question` (Lookup que consulta outra tabela), para a origem das opções nunca ficar sem registro |
| Script cru | **não** entra no JSON final — é levantamento, não backup |
| Chamada de outro script (GlideAjax / Script Include) | registrar que chama e o que faz com o retorno; **não** sair lendo o outro script |
| Glide List com vários valores | só os nomes (`"Admin, ITIL"`); com um valor só, mantém `{_display_value, __text}` |
| `vc_catalog_client_scripts` | corrigido para `vs_catalog_client_scripts` |
| `catalog_client_script` | permanece no singular |
| `reference` | presente em `catalog_variables` **e** `vs_variables` (mesmo conjunto de campos nos dois) |
| `type` da variável | acompanhado de `type_label` lido do `sys_choice` da instância |
| `catalog_conditions` | mantido com os `IO:<sys_id>`, mais um `catalog_conditions_label` com os nomes das variáveis |
| `default_value` | incluído |

> O exemplo que originou este contrato foi montado à mão para explicar a
> estrutura — os sys_ids dele não são dados reais e não devem ser usados como
> referência cruzada.

## Ainda aberto

- **Flows**: o gatilho do Record Producer costuma ser uma trigger própria em
  `sys_hub_flow` sobre a tabela destino, não o campo `flow_designer_flow` do
  item. Nesta fase só emitimos o que estiver nos campos do próprio registro.
