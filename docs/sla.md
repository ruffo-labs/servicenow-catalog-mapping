# SLA, OLA e Underpinning contract — estrutura e como o agente mapeia

Vale para qualquer instância. O que é número ou nome de instância específica
não entra aqui — fica nos achados daquele levantamento.

Cada afirmação leva o grau de confiança, como no resto do projeto:

- **[instância]** — lido do `sys_dictionary`, `sys_choice` ou de registro, em
  mais de uma instância.
- **[produto]** — comportamento conhecido do ServiceNow que a instância não
  contradiz mas o agente **não leu**. Conferir antes de tratar como regra.

## 1. Duas tabelas, dois papéis

| Tabela | Papel | Volume | O agente coleta? |
|---|---|---|---|
| `contract_sla` | a **definição** — prazo, calendário e as condições do ciclo de vida | centenas a milhares | sim (`slas[]`) |
| `task_sla` | a **execução** — um registro por par (tarefa, definição) | **milhões** | não |

[instância] A `task_sla` liga as duas por `sla` (→ `contract_sla`) e `task`
(→ `task`, qualquer tabela que estenda). Guarda `stage`, `has_breached`,
`start_time`, `end_time`, `planned_end_time`, `percentage`, `pause_time` e os
pares decorridos/de calendário útil (`duration`/`business_duration`,
`time_left`/`business_time_left`, `percentage`/`business_percentage`).

**Nunca `queryAll` na `task_sla`.** Numa instância medida são 18 milhões de
linhas. Para saber se uma definição **roda de verdade**, use a Aggregate API
(`/api/now/stats/task_sla`, filtro `sla=<sys_id>`, e `active=true` para as que
estão vivas). Definição sem nenhuma `task_sla` nunca disparou — candidata a
morta. É o equivalente de `executions` do fulfillment, e hoje não é coletado.

## 2. Os três tipos (`contract_sla.type`)

[instância] Valores crus: `SLA`, `OLA`, `Underpinning contract`. Os três vivem na
mesma tabela e saem em `slas[]`, separados por `type`.

**O terceiro tipo não é raro de esquecer — já deu conta errada.** Um resumo que
dizia "781 (695 SLA + 77 OLA)" não fechava: faltavam 9 `Underpinning contract`.
Hoje o total sai com os três (`_scope.totals.other`).

**Use sempre o valor cru.** O rótulo vem no idioma do usuário de integração
([instância] `SLA` aparece como "ANS" em pt-BR). Filtre por `type=SLA`, nunca
pelo rótulo.

| Tipo | Mede | Observação |
|---|---|---|
| `SLA` | o caso | regra do projeto; ver a ressalva abaixo |
| `OLA` | a tarefa | idem |
| `Underpinning contract` | contrato com fornecedor | [produto] usa o campo `vendor` (→ `core_company`) |

[instância] **Não assuma o par tipo↔tabela; leia `collection`.** Numa instância
as tabelas de caso tinham zero OLA (todos nas de tarefa), e por isso o recorte
de record producer sobe para as tabelas de tarefa (`docs/related-objects.md`).
Noutra, a própria `sc_req_item` tem SLA **e** OLA.

## 3. A definição, campo a campo

Todos os campos abaixo conferidos no dicionário de `contract_sla`
(48 colunas; a tabela estende só `sys_metadata`).

### Identificação

| Campo | Conteúdo |
|---|---|
| `name` | texto traduzível |
| `active` | |
| `collection` | **a tabela** onde a definição vale (`table_name`) |
| `type` | ver seção 2 |
| `target` | `response` ou `resolution` — o que o prazo mede |

### Prazo e calendário

| Campo | Valores / conteúdo |
|---|---|
| `duration` | `glide_duration`; é o prazo fixo |
| `duration_type` | → `cmn_relative_duration`. O único choice fixo é `NULL_OVERRIDE` ("User specified duration") |
| `relative_duration_works_on` | `Task record` ou `SLA record` |
| `schedule` | → `cmn_schedule` |
| `schedule_source` | `no_schedule`, `sla_definition` ou `task_field` (com `schedule_source_field`) |
| `timezone`, `timezone_source` | origem do fuso: `sla.timezone`, `task.location.time_zone`, `task.caller_id.time_zone`, `task.caller_id.location.time_zone`, `task.cmdb_ci.location.time_zone` |

- [instância] Com `duration_type` vazio, o prazo é o `duration`. Com
  `duration_type` preenchido é **duração relativa** (ex.: "até o fim do próximo dia
  útil"); o agente **não leu** a `cmn_relative_duration`, então não diz qual é.
- [instância] A `task_sla` guarda o tempo duas vezes — corrido e em calendário
  útil. [produto] Qual conta para a quebra depende do `schedule`; definição sem
  calendário (`no_schedule`) mede em tempo corrido. Ao comparar prazos, compare
  só definições com o mesmo `schedule_source` e o mesmo `schedule`.

### Ciclo de vida

Seis condições, todas do tipo `conditions` (encoded query):

| Campo | Quando |
|---|---|
| `start_condition` | a tarefa entra na definição |
| `pause_condition` | o relógio para |
| `resume_condition` | o relógio volta (só vale com `when_to_resume=on_condition`) |
| `stop_condition` | o SLA termina |
| `cancel_condition` | o SLA é cancelado (só vale com `when_to_cancel=on_condition`) |
| `reset_condition` | reinicia — ação em `reset_action` |

Os choices que controlam a leitura (os rótulos do próprio dicionário confirmam o
sentido):

| Campo | Valores |
|---|---|
| `when_to_resume` | `no_match` — as condições de **pausa** deixam de ser atendidas · `on_condition` — as de reinício foram atendidas |
| `when_to_cancel` | `never` · `no_match` — as de **início** deixam de ser atendidas · `on_condition` — as de cancelamento foram atendidas |
| `reset_action` | `complete` ou `cancel` o `task_sla` existente |

Por isso **ler só a `cancel_condition` engana**: com `when_to_cancel=no_match` a
definição cancela quando o início deixa de valer, mesmo com `cancel_condition`
vazia.

Outros: `retroactive` e `retroactive_pause` (rótulos "Retroactive start" e
"Retroactive pause") e `set_start_to`. [produto] `set_start_to` é um campo da tarefa cujo valor vira o
horário de início, no lugar de "agora" — o dicionário só diz "Set start to",
tipo nome de campo.

Dicionário tem ainda `service_commitment` (booleano), que o agente **não lê**.

### Motor: `workflow` x `flow`

`workflow` (→ `wf_workflow`, o legado) e `flow` (→ `sys_hub_flow`). [produto] É o
que roda nos marcos de percentual do prazo (avisar, escalar). O agente guarda só a
referência — **não lê o que o motor faz**.

**Qual dos dois a instância usa varia**, não assuma: medido numa instância,
todas as definições em `flow`; noutra, 3.395 de 3.417 em `workflow` e 22 em
`flow`. Numa amostra, o `workflow` era um registro de nome `Default SLA workflow`;
o que ele faz **não foi lido**. `enable_logging` é o
campo "Enable logging" da definição.

### Condição avançada (a parte que o agente não enxerga)

`condition_class` (→ `sla_condition_class`) e `adv_condition_type`
(`none`, `advanced`, `advanced_journal`, `advanced_system`,
`advanced_journal_and_system`) indicam que parte da avaliação não está nas seis
condições. [produto] A lógica fica num registro de classe de condição, com script.
O agente **não lê** a `sla_condition_class` — a definição aparece em `slas[]`, mas
o comportamento está incompleto. Em levantamento, filtre as definições com
`condition_class` preenchido ou `adv_condition_type` diferente de `none` e trate
como "não explicadas".

## 4. Como o agente coleta

`src/catalog/related.js`, lendo `contract_sla` por `collection IN (<tabelas do recorte>)`,
com os campos de `SLA_FIELDS` (`src/catalog/fields.js`). Vira `slas[]` no
`related-map` e, depois do `merge-related`, no arquivo completo.

| Origem do item | Tabela(s) do recorte |
|---|---|
| Item de catálogo comum | sempre `sc_req_item`, sem descoberta — e `sc_task` fica de fora |
| Record producer | `table_name` do producer **mais** tudo que estende `task` nos mesmos `sys_scope` |

### O vínculo com o item, e onde ele falha

`collection` é vínculo **grosso**: a definição vale para todo registro da tabela,
de qualquer item. O fino é `cited_items[]`: o agente procura sys_ids de 32
caracteres nas seis condições e resolve para o nome do item (`<campo>_label`
guarda a condição com o nome no lugar).

Três limites, todos de leitura do código:

1. **`cited_items` vazio não quer dizer "não vale para o item".** Condições
   costumam filtrar por outro atributo — grupo de atribuição, canal, oferta de
   serviço, categoria. Nesses casos o item entra por um caminho que o regex não vê.
   Só dá para afirmar o contrário: `cited_items` cheio **prova** que a definição
   cita o item.
2. **Casamento exato de `collection`.** A coleta usa `IN` com as tabelas do recorte.
   [produto] Uma definição criada numa tabela **pai** (ex.: `task`) vale para as
   filhas e **não entraria** no mapa. Verificação de uma chamada, em ambiente novo:
   `contract_sla` com `collection=task` (e `collection=<pai da tabela do recorte>`).
   Numa instância medida deu zero; em outras, não foi medido.
3. **Defasagem.** `contract_sla` é editada o tempo todo. Quando o `related-map`
   é reaproveitado de uma rodada anterior, a contagem de hoje pode diferir:
   medido, 785 definições na `sc_req_item` contra 781 no mapa de dois meses
   antes — diferença de 4, provavelmente definições criadas depois; não
   investigado. Rode `scripts/extract-related.js` sem `--confirm` para ver a contagem
   atual antes de reaproveitar.

### Conferência rápida de uma coleção de SLA

```bash
node scripts/extract-related.js --map out/<fatia>/catalog-map.json   # contagens atuais, sem coletar
```

E, no JSON:

- `slas.length` = SLA + OLA + `other` (os três tipos). Não fecha → olhe o `type`.
- `slas[].type` só pode ser um dos três.
- Definição ativa com `collection` fora do recorte esperado → recorte errado.
- `slas_citing_items` em `_scope.totals` é o vínculo fino; o resto vale "para a tabela".

## 5. O que fica de fora de propósito

- A `task_sla` (execução) — ver seção 1 para medir com Aggregate.
- O que `flow`/`workflow` fazem, a `sla_condition_class` e a `cmn_relative_duration`.
- Business rules que mexem em SLA (fora de escopo do projeto).
