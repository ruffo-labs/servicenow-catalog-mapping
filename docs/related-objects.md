# Objetos relacionados à tabela destino

Notificações, SLA/OLA, reports e portais. Não pertencem ao item de catálogo —
pertencem à **tabela** onde o record producer grava. Por isso saem em coleções
próprias no topo do JSON, como `variable_sets`, e não dentro de cada item: um
mesmo SLA vale para os 148 itens que caem na mesma tabela.

Arquivo de saída: `out/<fatia>/related-map.json`
Script: `scripts/extract-related.js` · Módulo: `src/catalog/related.js`

```bash
node scripts/extract-related.js --map out/consolidado/catalog-map.json
node scripts/extract-related.js --map out/consolidado/catalog-map.json --confirm
```

Não refaz a fase 1 do catálogo: lê o `catalog-map.json` pronto para descobrir as
tabelas e os catálogos. Zero token, tudo `GET`.

---

## Como cada coisa se liga (lido do `sys_dictionary`, não da memória)

| Coleção | Tabela | Campo de ligação | Tipo |
|---|---|---|---|
| `notifications[]` | `sysevent_email_action` | `collection` | `table_name` |
| `slas[]` | `contract_sla` | `collection` | `table_name` |
| `reports[]` | `sys_report` | **`table`** (não `collection`) | `table_name` |
| `portals[]` | `sp_portal` | **nenhum** — ver abaixo | — |

`sp_portal` **não tem campo de tabela**. O vínculo real é por catálogo, pela m2m
`m2m_sp_portal_catalog` (`sp_portal` × `sc_catalog`). O campo `sp_portal.sc_catalog`
existe, mas é só o catálogo *padrão* do portal — na instância da Natura ele está
preenchido em 4 dos 42 portais e em nenhum dos catálogos mapeados. Usar só ele
devolveria zero portal.

## Catalog item comum: a tabela é sempre `sc_req_item`

Decisão do usuário: **item sem `table_name` (catalog item, não record producer)
gera RITM, então a tabela de ligação é sempre `sc_req_item`.** Não há tabela
destino a descobrir. O `extract-related.js` faz isso sozinho; um mapa só de
catalog items deixou de ser erro.

Duas consequências, medidas num levantamento só de catalog items:

1. **O recorte não sobe para tabelas de tarefa.** A expansão "tudo que estende
   `task` no mesmo `sys_scope`" vale para tabelas destino de record producer, que
   moram num app próprio. `sc_req_item` é do catálogo inteiro da plataforma;
   expandir pelo escopo dela traria as tarefas de tudo. Quando o mapa mistura
   producers e catalog items, `sc_req_item` entra na lista mas **não** define
   escopo — só os destinos dos producers definem.
2. **`sc_req_item` é compartilhada por todos os catálogos da instância.** A
   coleta traz tudo que está ligado à tabela, não só o que fala dos itens
   mapeados. A coleção sai com centenas de notificações e SLA e milhares de
   reports, e **só uma fração cita** algum dos itens na condição. O resto vale
   para todo RITM da instância. Para saber o que é específico do levantamento,
   filtre por `cited_items[]` (ver abaixo) — e leia a ressalva em `docs/sla.md`
   seção 4: `cited_items` vazio não prova que a definição não vale para o item.

**O que fica de fora por decisão:** `sc_task` (a tarefa do RITM) e `sc_request`
não entram. Se um dia o OLA de tarefa for necessário, é ampliar `caseTables` em
`discoverScope`, não coletar à mão. Conte antes (`contract_sla` com
`collection=sc_task`) para saber se vale a pena.

## O recorte: por que entram as tabelas de tarefa

Vale para **record producers**. As tabelas destino saem dos `table_name` dos
record producers mapeados. Só que:

> **O SLA mede o caso; o OLA mede a tarefa.**

Nas 5 tabelas de caso da Natura QA há 440 SLA e **zero OLA**. Os OLA estão todos
nas tabelas de tarefa do mesmo aplicativo (`x_nasm_hr_htr_task` sozinha tem 146).
Recortar só pelas tabelas de caso devolveria uma coleção de OLA vazia.

Por isso o recorte sobe para **tudo que estende `task` dentro dos mesmos
`sys_scope`** das tabelas de caso. O critério é a herança resolvida pelo
`sys_db_object.super_class`, não o prefixo do nome — prefixo seria chute, e
pegaria `x_nasm_avon_hist_0_task_sla`, que é de outro app.

O `_scope` do JSON registra o que entrou e por quê:

```json
"_scope": {
  "application_scopes": ["Finance", "Human Resources", "PTP", "RTR", "TAX"],
  "case_tables": [{ "name": "x_nasm_hr_case", "items": 148, "item_sys_ids": ["..."] }],
  "task_tables": [{ "name": "x_nasm_hr_htr_task", "extends": "x_nasm_hr_task > task" }],
  "catalogs": [{ "sys_id": "...", "title": "Hire to Retire (HTR)", "items": 149 }],
  "catalogs_without_portal": [...],
  "totals": { "notifications": 0, "sla": 0, "ola": 0, "reports": 0, "portals": 0 }
}
```

`case_tables[].item_sys_ids` é o que amarra de volta ao `catalog-map.json`: dá
para saber quais itens são afetados por uma notificação olhando o `collection`
dela e procurando a tabela aqui. A lista fica **num lugar só** de propósito —
repetir 148 sys_ids em cada uma das 467 notificações inflaria o arquivo à toa.

## `notifications[]` — `sysevent_email_action`

**O corpo do e-mail não entra** (decisão do usuário, 2026-09-21). `message_html`
soma 388 KB nesta instância e é template; o que interessa é *quando dispara,
para quem vai e sob que condição*. `message_text` está vazio em todos os 467.

| Grupo | Campos |
|---|---|
| Identificação | `name`, `description`, `active`, `collection`, `type`, `category` |
| Quando dispara | `event_name`, `generation_type`, `action_insert`, `action_update`, `affected_field_on_event`, `event_parm_1/2` |
| Condição | `condition`, `advanced_condition` (script → `script_understanding`) |
| Destinatário | `recipient_users`, `recipient_groups`, `recipient_fields`, `exclude_delegates`, `send_self` |
| Cabeçalho | `subject`, `from`, `reply_to`, `importance`, `template`, `style` |
| Entrega | `force_delivery`, `mandatory`, `subscribable`, `digestable`, `weight`, `order` |

`recipient_users` e `recipient_groups` são Glide List — saem no formato de lista
do contrato. `recipient_fields` é `field_list`: nomes de campo, string simples.

O `advanced_condition` é o único script destas coleções e entra na fase 2 pelo
mesmo mecanismo do catálogo (fila `_related-scripts-pending.json`, dedupe por
hash, cache compartilhado).

## `slas[]` — `contract_sla`

SLA e OLA vêm da mesma tabela; **`type` separa**. Saem numa coleção só, ordenada
por tabela e tipo, porque é como a instância guarda.

| Grupo | Campos |
|---|---|
| Identificação | `name`, `active`, `collection`, `type`, `target` |
| Prazo | `duration`, `duration_type`, `relative_duration_works_on` |
| Calendário | `schedule`, `schedule_source`, `schedule_source_field`, `timezone`, `timezone_source` |
| Ciclo de vida | `start_condition`, `pause_condition`, `resume_condition`, `stop_condition`, `cancel_condition`, `reset_condition`, `when_to_cancel`, `when_to_resume`, `reset_action`, `set_start_to` |
| Motor | `flow`, `workflow` |
| Outros | `condition_class`, `adv_condition_type`, `retroactive`, `retroactive_pause`, `enable_logging`, `vendor`, `sys_overrides` |

Não tem script: o comportamento está nas condições, que são encoded query.

**Qual motor a instância usa varia**: numa, todas as definições em `flow` (Flow
Designer); noutra, quase todas em `workflow` legado. Não assuma. Estrutura
completa, valores dos choices, o terceiro `type` (`Underpinning contract`) e os
limites do vínculo com o item: `docs/sla.md`.

## `reports[]` — `sys_report`

| Grupo | Campos |
|---|---|
| Identificação | `title`, `description`, `table`, `type`, `active` |
| Conteúdo | `filter`, `field_list`, `aggregate`, `aggregation_source`, `column`, `source_type`, `report_source` |
| Acesso | `user`, `roles`, `is_published`, `shared_with[]` |
| Operação | `is_scheduled`, `display_grid`, `sys_created_by/on`, `sys_updated_by/on` |

`shared_with[]` vem de `sys_report_users_groups` e diz com quem o report foi
compartilhado (`type: "user"` ou `"group"`). É o que distingue report de
trabalho de rascunho pessoal esquecido: nesta instância **639 dos 650 têm
compartilhamento explícito** — só 11 são realmente privados.

**`user` não é só "o dono".** Ele carrega a visibilidade: o sys_id do dono
quando o report é pessoal (396 casos), a string `GLOBAL` quando é global (161)
ou `group` quando é de grupo (93). Testar `user` como referência dá errado —
por isso `sys_report.user` **não** entra no conjunto de Glide Lists do
`shapeRecord` (ver o parâmetro `listFields`).

**Atenção a três nomes que a memória do modelo inventa e não existem aqui:**
`group_by`, `order_by` e `chart_type`. O agrupamento está em `aggregation_source`
e `column`.

## `portals[]` — `sp_portal`

Só os portais que expõem um dos catálogos mapeados, via `m2m_sp_portal_catalog`.
Cada entrada leva `mapped_catalogs[]` com quais dos catálogos do levantamento
aquele portal publica.

**`sp_portal` usa `inactive`, não `active`.** Inverter isso faz o portal ativo
parecer desligado.

Campos: `title`, `url_suffix`, `inactive`, `default`, páginas (`homepage`,
`login_page`, `notfound_page`, `sc_catalog_page`, `sc_category_page`,
`kb_knowledge_page`), tema (`theme`, `dark_theme`, `logo`, `icon`), catálogo e
base de conhecimento padrão, e as flags de autenticação.

`_scope.catalogs_without_portal` lista os catálogos do levantamento que **não
estão em portal nenhum** — pode ser catálogo só de Virtual Agent, pode ser furo
de configuração. Vale conferir caso a caso, não concluir direto.

## O vínculo fino: `cited_items[]` e `<campo>_label`

A tabela é um vínculo grosso — diz que o SLA vale para os 148 itens que gravam
em `x_nasm_hr_case`. Mas as condições costumam citar o **sys_id do item** direto:

```
start_condition: state=1^x_nasm_hr_item=5f13e4311bbfd154d1abda4ce54bcb3e^...
```

Isso é ilegível e esconde o elo. Cada registro ganha então:

- **`<campo>_label`** — a mesma condição com o sys_id trocado pelo nome do item.
  Só aparece quando alguma coisa foi resolvida; o campo original fica intacto.
- **`cited_items[]`** — os itens do levantamento citados nas condições, no
  formato de referência do contrato.

Campos varridos: `condition` (notificação), as seis condições de ciclo de vida
do SLA e `filter` (report).

Cobertura medida: **486 dos 858 SLA/OLA, 201 das 467 notificações e 243 dos 650
reports** citam um item do levantamento. Quem não cita vale para a tabela
inteira — o que também é informação.

## Fase 2

Só o `advanced_condition` das notificações produz `script_understanding`. Entra
no mesmo ciclo do catálogo:

```bash
node scripts/extract-related.js --map out/consolidado/catalog-map.json --confirm
#   -> explicar out/consolidado/_related-scripts-pending.json
#   -> escrever out/consolidado/_scripts-understood.json
node scripts/merge-understandings.js out/consolidado
```

O `merge-understandings.js` preenche o `catalog-map.json` e, se existirem,
também o `related-map.json`. Cache e dedupe por hash são os mesmos.

**A ordem importa.** O `extract-related` regrava o `related-map.json` com os
scripts em branco, então ele vem **antes** do `merge-understandings`:

```
extract → extract-related → explicar → merge-understandings → merge-related
```

Inverter faz as condições avançadas voltarem nulas no arquivo final. O
`merge-understandings` sabe preencher as notificações tanto no
`related-map.json` quanto dentro do `catalog-map.json` já mesclado, então dá
para consertar rodando ele de novo no fim.

## Um arquivo só

O padrão é arquivo separado — o `catalog-map` continua sendo só o catálogo.
Para juntar tudo num JSON:

```bash
node scripts/merge-related.js out/consolidado
node scripts/merge-related.js out/consolidado --map <arq> --related <arq>
```

Não consulta a instância: trabalha com o que já está em disco. Pega os dois
arquivos **mais recentes** da pasta e grava um terceiro:

```
catalog-map_2026-09-23_14-57-21.json           (entrada, intacta)
related-map_2026-09-23_15-10-02.json           (entrada, intacta)
catalog-map-completo_2026-09-23_15-12-40.json  (saída)
```

**Nada é sobrescrito**, então não há cópia de segurança nem `--undo`: o
original continua no lugar e comparar é só abrir os dois.

O merged fica assim, com as coleções antigas primeiro e intactas:

```json
{
  "itens": [...], "variable_sets": [...], "user_criteria": [...],
  "related_scope": { ... }, "notifications": [...],
  "slas": [...], "reports": [...], "portals": [...]
}
```

O `_scope` do related vira **`related_scope`** no arquivo único, para não
competir com uma chave de mesmo nome no futuro.

Antes de juntar, o script confere que o related foi gerado **deste mesmo
recorte** — se os itens do escopo não estiverem no `catalog-map`, ele recusa
em vez de misturar levantamentos.

## Números do levantamento (instancenaturasnqa, 2026-09-21)

Recorte: 5 tabelas de caso + 17 de tarefa, dos escopos Finance, Human Resources,
PTP, RTR e TAX.

| | |
|---|---|
| Notificações | 467 (410 ativas) |
| SLA | 454 |
| OLA | 404 |
| Reports | 650 (1.010 compartilhamentos) |
| Portais | 2 de 42 |
| Citam um item do levantamento | 201 notificações, 486 SLA/OLA, 243 reports |
| Scripts (`advanced_condition`) | 23 ocorrências → **3 únicos** |
| Fase 1 | 187 chamadas, ~4 min, **0 token** |
| Fase 2 | 3 scripts, ~1k tokens |
| `related-map.json` | 4,4 MB |

Para comparação, o `catalog-map.json` do mesmo recorte tem 17,6 MB. Os objetos
relacionados custam pouco justamente por serem normalizados por tabela.
