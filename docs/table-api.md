# Conexão via Table API

> Somente `GET`. Ver DIRETRIZ #1 em `CLAUDE.md`.

## Endpoints usados

| Uso | Endpoint |
|---|---|
| Listar registros | `GET /api/now/table/{tabela}` |
| Um registro | `GET /api/now/table/{tabela}/{sys_id}` |
| Contagem | `GET /api/now/stats/{tabela}?sysparm_count=true` |
| Metadados | `GET /api/now/table/sys_dictionary` / `sys_choice` |

## Parâmetros que sempre usamos

- `sysparm_query` — encoded query (`^` = AND, `^OR` = OR, `^ORDERBY`)
- `sysparm_fields` — só as colunas necessárias; corta payload e tempo
- `sysparm_display_value=all` — traz `{value, display_value}` por campo, então
  guardamos sys_id **e** label sem uma segunda chamada
- `sysparm_exclude_reference_link=true` — remove as URLs de referência, que só
  inflam o JSON
- `sysparm_limit` / `sysparm_offset`

## Paginação: keyset, não offset

`sysparm_offset` fica caro rápido — o ServiceNow varre as linhas descartadas a
cada página. `TableApi.iterate()` usa cursor por `sys_id`:

```
sysparm_query=<filtro>^sys_id><último_sys_id>^ORDERBYsys_id
```

Custo constante por página, e é estável mesmo se alguém alterar registros
durante a coleta.

## Consultas do catálogo

Itens e record producers vêm da **mesma** tabela base:

```
# ambos
sc_cat_item?sysparm_query=active=true

# só record producers
sc_cat_item?sysparm_query=sys_class_name=sc_cat_item_producer

# só item "normal", sem as classes filhas
sc_cat_item?sysparm_query=sys_class_name=sc_cat_item
```

Filtros que o agente vai oferecer a quem executa:

| Filtro | Encoded query |
|---|---|
| Catálogo | via m2m `sc_cat_item_catalog?sysparm_query=sc_catalog=<sys_id>` |
| Categoria | via m2m `sc_cat_item_category?sysparm_query=sc_category=<sys_id>` |
| Ativo | `active=true` |
| Tipo | `sys_class_name=sc_cat_item_producer` (ou `IN` com várias classes) |
| Nome contém | `nameLIKEacesso` |
| sys_id específico | `sys_idIN<a>,<b>,<c>` |
| Escopo | `sys_scope=<sys_id>` |
| Atualizado depois de | `sys_updated_on>=2026-01-01 00:00:00` (GMT) |

### Dependências por item

```
item_option_new?sysparm_query=cat_item=<id>^ORDERBYorder
io_set_item?sysparm_query=sc_cat_item=<id>            -> variable_set
item_option_new?sysparm_query=variable_set=<set_id>
question_choice?sysparm_query=question=<var_id>^inactive=false^ORDERBYorder
catalog_ui_policy?sysparm_query=catalog_item=<id>
catalog_ui_policy_action?sysparm_query=ui_policy=<policy_id>
catalog_script_client?sysparm_query=cat_item=<id>
sc_cat_item_user_criteria_mtom?sysparm_query=sc_cat_item=<id>
```

Otimização: em vez de N chamadas por item, uma chamada por tabela com
`cat_itemIN<id1>,<id2>,...` (lotes de ~50 sys_ids) e agrupar em memória.

## Notas operacionais

- **Fuso:** datas na Table API saem em GMT quando `sysparm_display_value=false`
  e no fuso do usuário quando `true`. Com `all` vêm as duas — usar sempre a
  `value` para comparações.
- **ACL:** a Table API filtra por ACL **silenciosamente**. Um item invisível
  para a credencial simplesmente não aparece na resposta, sem erro. Por isso o
  `test-connection` compara contagens antes de confiar no resultado.
- **429:** `snClient` respeita `Retry-After` e faz backoff exponencial.
- **HTML na resposta:** sinal de sessão inválida ou usuário sem
  `snc_platform_rest_api_access`. O cliente converte isso em `ServiceNowError`
  em vez de estourar um erro de JSON.

## Exceção única ao "só GET"

Se `SN_AUTH_TYPE=oauth`, há um `POST /oauth_token.do` para obter o token. É o
protocolo OAuth, não toca em nenhum registro, e está isolado em
`ServiceNowClient.#authHeader()`. Com `SN_AUTH_TYPE=basic` (o padrão) nem isso
existe.

---

# Aprendizados da instância (alpartecnologialtdademo3, 2026-09-17)

## Precedência do `^OR` na encoded query

`^OR` agrupa com a condição **imediatamente anterior**, não com tudo antes dela:

```
active=true^short_description=X^ORname=Y
  ==  active=true AND (short_description=X OR name=Y)
```

Consequência prática: no exemplo acima, se o item `Y` estiver inativo ele **não**
aparece. Para um OR de verdade sobre o conjunto todo, use `^NQ` (nova query).

## `item_option_new.type` é herdado de `question`

`sys_choice` com `name=item_option_new^element=type` volta **vazio** — o campo
vem da tabela pai `question`. O lugar certo é `name=question^element=type`
(31 choices nesta instância).

Na prática o `type_label` nem depende disso: `sysparm_display_value=all` já
resolve o label junto com o valor. O `sys_choice` serve só para conferência.

Mapa desta instância, nos pontos onde a memória costuma errar:

| value | label |
|---|---|
| 19 | Container Start |
| 20 | **Container End** |
| 21 | **List Collector** |
| 22 | Lookup Multiple Choice |
| 24 | Container Split |
| 31 | Requested For |
| 33 | Attachment |

## Campos reais de `sc_cat_item_producer`

Não existem `redirect_to` nem `view_id`. Os campos próprios da classe são:

| Campo | Tipo | Label |
|---|---|---|
| `table_name` | table_name | Table name |
| `script` | script_plain | Script |
| `post_insert_script` | script_plain | Post insert script |
| `save_script` | script_plain | Save script |
| `redirect_url` | string | Redirect to |
| `view` | string | View |
| `can_cancel` | boolean | Can cancel |
| `allow_edit` | boolean | Allow edit |
| `save_options` | string | Save options |

O contrato usa hoje `table_name`, `script`, `redirect_url` e `view`.

## Select Box que não tem `question_choice`

Uma variável pode ser Select Box (`type=5`) e ter **zero** linhas em
`question_choice` porque as opções vêm da tabela destino, via
`choice_table` + `choice_field` (ex.: `urgency` do Record Producer
"Create Incident" puxa de `incident.urgency`).

A regra do contrato ("se existe choice, mapeia") continua correta. Para o caso
não coberto por ela, a variável agora carrega também `choice_table`,
`choice_field`, `choice_direction`, `include_none` e os `lookup_*` — assim a
**origem** das opções fica registrada mesmo quando `question_choices` não existe.

## Cache de dicionário

A validação de campos custa **58 chamadas fixas** (12 tabelas × caminhar a
hierarquia de herança + ler `sys_dictionary`), independente de quantos itens
sejam mapeados. Em rodadas pequenas isso domina o custo.

Fica em cache por instância em `.cache/dictionary-<host>.json`, TTL de 7 dias.
Medido: 78 chamadas na primeira execução, **20 na segunda**.

O cache é por host, então trocar o `.env` de instância não reaproveita o
dicionário errado. Depois de mexer na estrutura da instância (campo novo,
tabela nova), rode com `--refresh-dict`.

## ARMADILHA: `^NQ` quebra a paginação por keyset

`^NQ` (new query) cria **grupos independentes** na encoded query — é um OR de
nível superior. O cursor do keyset é anexado no fim:

```
<query>^sys_id><cursor>^ORDERBYsys_id
```

Com `^NQ`, esse `^sys_id>` gruda **só no último grupo**. Os grupos anteriores
ficam sem filtro de cursor, devolvem sempre as mesmas linhas, e a paginação
entra em **loop infinito** martelando a instância.

Encontrado com uma query real de 248 itens:

```
sc_catalogsLIKE<a>^OR...^active=true^NQsys_id=<x>^ORsys_id=<y>^ORsys_id=<z>
```

Rodou 10 minutos sem terminar. Depois da correção: 1 segundo.

**Correções aplicadas em `TableApi.iterate`:**

1. Query contendo `^NQ` usa **paginação por offset** em vez de keyset. Mais
   cara, mas correta — não dá para prender um cursor a todos os grupos, porque
   encoded query não tem parênteses.
2. **Trava anti-loop** no keyset: se o último `sys_id` da página repetir um já
   visto, lança erro em vez de continuar. Rede de segurança para qualquer outro
   padrão de query não previsto.

Lição geral: keyset só é seguro quando a query é uma **conjunção única**.
Qualquer coisa que crie grupos de nível superior invalida o cursor.
