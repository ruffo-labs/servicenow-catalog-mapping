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

## Nome dos arquivos

Cada execução grava com o carimbo da hora no nome, então nada é sobrescrito:
`catalog-map_2026-09-23_14-57-21.json`. O `-` no lugar do `:` é exigência do
Windows. Detalhes e as exceções em `CLAUDE.md`.

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

## `itens[].volume` — chamados já abertos

Só existe quando o extract roda com `--volume`.

```json
"volume": {
  "total": "53656", "last_12m": "11845", "last_90d": "1408",
  "rank": "1", "share_pct": "8.29",
  "source_table": "x_nasm_hr_case", "source_field": "x_nasm_hr_item",
  "measured_at": "2026-09-23 02:10:00"
}
```

`rank` e `share_pct` são calculados dentro do recorte, para não obrigar quem
lê o JSON a ordenar 248 itens na mão. Item sem nenhum chamado sai com `"0"`
explícito — ausência da chave significaria "não medido", que é outra coisa.

## `itens[].conversational` — o item serve para a IA pedir?

Sempre presente. **Avaliação**, não campo da instância: separa
`declarado_na_instancia` (fato) de `veredito` / `bloqueadores` / `avisos`
(regra aplicada sobre critérios publicados pela ServiceNow). Campo a campo e
fontes em `docs/conversational.md`.

## `itens[].reference_choices` — opções de variável que aponta para outra tabela

**Só existe em instância com regra própria** (`INSTANCE_RULES` em
`src/catalog/referenceChoices.js`, chaveada pelo host). Nas demais a chave **não
aparece** e o item sai como sempre saiu.

Por que fica no item e não no `variable_set`: o set é compartilhado (um mesmo set
entra em dezenas de itens), mas as opções dependem do item que o usa. A variável
continua no set; a lista de opções sai aqui. Itens sem variável apontando para a
tabela saem com `[]`.

`<campo>` abaixo é o campo de ligação da regra do ambiente (Glide List da tabela
referenciada que guarda os itens).

```json
"reference_choices": [{
  "reference_table": "service_offering",
  "link": "<campo>",
  "qualifier_mode": "advanced",
  "filter": "<campo>LIKE<sys_id do item>",
  "variables": [{
    "name": "service_offering", "sys_id": "...",
    "origin": "variable_set",
    "variable_set": { "_display_value": "<título do set>", "__text": "..." },
    "reference_qual": "javascript:..."
  }],
  "total": 12,
  "options": [{ "sys_id": "...", "number": "...", "name": "...",
                "operational_status": "1", "operational_status_label": "...", "...": "..." }]
}]
```

| Campo | O que é |
|---|---|
| `qualifier_mode` | o `use_reference_qualifier` da variável: `simple` (filtro legível em `reference_qual`), `advanced` (script), `dynamic` ou `none` |
| `link` | **grau de confiança**, como no fulfillment. `reference_qual` = o filtro **declarado na variável** foi executado (certeza). o nome do campo de ligação = regra do ambiente aplicada ao item (**candidato**) |
| `filter` | a encoded query que foi lida: o filtro declarado, ou `<campo>LIKE<item>` |
| `variables[]` | as variáveis (do item ou de set) que apontam para a tabela, por `reference` ou `lookup_table`; `origin` diz de onde vêm. Variáveis do mesmo item com origens de opção diferentes saem em blocos separados |
| `variables[].reference_qual` | o qualificador **como declarado**. Quando é script, **não foi lido**: a lista que o usuário vê pode ter filtros a mais que o campo de ligação |
| `options[]` | os registros da tabela. Entram **todos** os ligados ao item, inclusive os desativados — `operational_status` e `_label` permitem filtrar (os valores do choice variam por instância; o rótulo sai do próprio registro) |

Campos de `options[]`: ver `SERVICE_OFFERING_FIELDS` em `src/catalog/fields.js`
(identificação, status, grupos, `sla`/`u_ola_a`/`u_ola_r`, `u_flow`/`u_flow_task`,
aprovação, `u_user_criteria`, flags e os dois vínculos com o item). A lista é
validada contra o `sys_dictionary` a cada rodada.

**Lista, não referência única:** ao escolher o campo de ligação de um ambiente,
confira se existe a versão em lista e a versão única. A lista é o vínculo mais
geral — ofertas ligadas a mais de um item, lista vazia e referência única fora da
lista aparecem. Meça os três casos antes de decidir.

## Coleções da tabela destino (arquivo irmão)

Notificações, SLA/OLA, reports e portais **não** entram em `itens[]`: eles
pertencem à tabela onde o record producer grava, não ao item. Saem em
`related-map.json`, com o mesmo formato de valores deste contrato:

```json
{ "_scope": {...}, "notifications": [...], "slas": [...],
  "reports": [...], "portals": [...] }
```

Campo a campo em `docs/related-objects.md`. Com `scripts/merge-related.js`
essas coleções passam para dentro do `catalog-map.json` (o `_scope` vira
`related_scope`), sem alterar `itens`, `variable_sets` nem `user_criteria`.

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
- `catalog_ui_policies[].script_true` e `script_false` (itens e `variable_sets[].vs_ui_policies[]`)
- `catalog_variables[].read_script`, `post_insert_script` e `save_script` (itens e `vs_variables[]`)

**Script sem código vira `""`** em variável e UI policy: só comentário, o stub
`function onCondition() {}` ou o comentário-modelo do `save_script`. Num
levantamento real, mais de 90% das ocorrências desses dois campos eram isso — sem
o corte, cada variável e cada policy carregaria um slot sem lógica. Client script e user criteria não passam por esse corte.

**Com `--with-source`** (pedido do usuário, para migração) o slot ganha o código:

```json
"script": { "script_understanding": "explicação...", "source": "function onChange(...) { ... }" }
```

`source` só existe nos slots de script do catálogo. As `advanced_condition` das
notificações, que vêm do `related-map`, não têm `source`.

### Configuradores da variável

`catalog_variables[]` e `vs_variables[]` trazem os campos de configuração lidos
do dicionário (`question` > `item_option_new`):

| Grupo | Campos |
|---|---|
| Layout (Container Start/Split/End, Pausa) | `layout` (`normal`, `2across`, `2down`), `display_title`, `variable_width`, `visibility` |
| Ajuda e texto | `show_help`, `show_help_on_load`, `help_text`, `instructions`, `tooltip`, `rich_text`, `default_html_value` |
| Validação | `unique`, `validate_regex`, `mask_use_confirmation`, `mask_use_encryption`, `do_not_select_first`, `scale_min`, `scale_max`, `list_table` |
| Qualificador e default dinâmico | `use_reference_qualifier`, `dynamic_ref_qual`, `use_dynamic_default`, `dynamic_default_value` |
| Onde aparece | `visible_standalone`, `visible_summary`, `visible_guide`, `visible_bundle`, `hide_on_grid` |
| Acesso | `read_roles`, `write_roles`, `create_roles` |
| Outros | `attributes` (Variable attributes) |

O variable set ganha `set_attributes` e as três roles. Client script ganha
`description`, `order`, `messages`, `global`, `view`; UI policy ganha
`description`, `global`, `inherit`, `reverse_if_false`, `run_scripts`, `view`;
a ação da policy ganha `field_message` e `field_message_type`. Variável, client
script, UI policy e user criteria trazem `sys_created_on/by` e `sys_updated_on/by`.

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
