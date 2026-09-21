# Fulfillment: quando o item é executado

> Levantado na instância `alpartecnologialtdademo3` em 2026-09-17. Somente leitura.

Existem **três** caminhos distintos, e eles não se parecem em nada entre si.

## Panorama da instância

| | workflow legado | flow designer | nenhum dos dois |
|---|---|---|---|
| Itens ativos (150) | 66 | 15 | 70 |
| **Record producers (25)** | **0** | **0** | **25** |

Ou seja: **nenhum** record producer usa os campos do item. Confirma a hipótese —
a execução deles vem sempre de trigger separada.

## Caminho 1 — Workflow legado (`sc_cat_item.workflow`)

`sc_cat_item.workflow` → `wf_workflow`.

**Armadilha:** o registro em `wf_workflow` tem `table`, `condition` e `active`
**vazios**. Ele é só o contêiner. Os dados reais estão na versão publicada:

```
wf_workflow_version?sysparm_query=workflow=<id>^published=true
```

Ali vem `table` (quase sempre `sc_req_item`), `condition` e `active`. Um mesmo
workflow costuma ter várias versões — só a `published=true` importa.

Exemplo: "Procurement Process Flow - Mobile" (Apple iPhone 13) → 2 versões,
a publicada com `table=sc_req_item`, sem condição. Roda na criação do RITM.

## Caminho 2 — Flow Designer no item (`sc_cat_item.flow_designer_flow`)

`sc_cat_item.flow_designer_flow` → `sys_hub_flow`. Invocado **diretamente** pelo
item, sem trigger instance — não existe trigger type "Service Catalog" aqui.

Ler de `sys_hub_flow`: `name`, `active`, `status`, `sys_scope`. Campos herdados
de `sys_hub_flow_base`.

## Caminho 3 — Trigger na tabela destino (o caso dos Record Producers)

O RP cria um registro em `table_name`. O que roda depois é o que estiver
disparando **naquela tabela**.

`sys_hub_trigger_instance` não tem `table` nem `condition` como coluna — são
*inputs* no padrão de variáveis do Flow Designer:

```
sys_variable_value?sysparm_query=document=sys_hub_trigger_instance^document_key=<trigger_sys_id>
```

Inputs observados: `Table`, `Condition`, `Run Trigger` (once/every/always),
`Run On Extended Tables`, `Run flow In` (foreground/background).

### Busca reversa (tabela → flows que disparam nela)

```
sys_variable_value?sysparm_query=document=sys_hub_trigger_instance^value=<tabela>
```

Filtrar pelos que têm o input `Table` (o input `Target table` é outra coisa),
pegar os `document_key` e ler as trigger instances.

Tipos de trigger nesta instância: Created, Updated, Created or Updated,
Recurrence, Inbound Email.

## Armadilhas confirmadas

1. **`sys_hub_flow.active` pode ser `false`.** O flow existe, tem trigger
   configurada, e mesmo assim nunca roda. Emitir o `active` junto, sempre.
   (O "Create Problem from Major Incident" desta instância está inativo.)
2. **Trigger instances duplicam.** A mesma combinação flow+condição apareceu
   duas vezes na busca por `incident`. Deduplicar.
3. **`wf_workflow` sem os dados** — ver Caminho 1.
4. **Business rules também disparam.** `incident` tem 48 ativas. São parte real
   do "quando executa", mas o volume é ruído se entrar sem critério.

## Achado principal (instancenaturasnqa, 2026-09-17)

**A condição da trigger cita o sys_id do próprio item.** O vínculo é exato, não
é heurística.

Na Natura QA, a tabela destino tem um campo de referência de volta para o item
(`x_nasm_hr_case.item` → `sc_cat_item_producer`) e as triggers condicionam nele:

```
condicao: item=f662d29e1ba2b810a530426fe54bcb8b
```

Esse sys_id resolve para o record producer "Reembolso Auxílio Creche ou Babá", e
o flow é "EY: Reimbursement of Daycare or Babysitting Assistance".

### Busca genérica (não depender do nome do campo)

O nome do campo (`item`) é específico desta instância. A busca robusta é pelo
**sys_id dentro da condição**, seja qual for o campo:

```
sys_variable_value?sysparm_query=document=sys_hub_trigger_instance^valueLIKE<sys_id do item>
```

Pega os `document_key`, lê as trigger instances, e dali o flow.

### Por que casar por nome não funciona

Testado: 151 record producers em `x_nasm_hr_case`, 92 flows distintos, **2**
nomes batendo. Os producers estão em português e os flows em inglês
("Rotinas de Folha de Pagamento" vs "Questions or Information Payroll").
Descartar essa abordagem.

## Runtime: o que realmente rodou

`sys_flow_context` (503k linhas nesta instância) com `source_record` +
`source_table`. Para atribuir ao producer, usar o mesmo campo de referência da
tabela destino (descobrível em `sys_dictionary`: campo `reference` apontando
para `sc_cat_item` ou `sc_cat_item_producer`).

### Estático + runtime juntos — o caso que provou o valor

Producer "Reembolso Auxílio Creche ou Babá":

| Flow | Estático | Runtime |
|---|---|---|
| EY: Reimbursement of Daycare or Babysitting Assistance | configurado, `active=true` | **4 execuções** |
| NAT&CO Auxílio Creche e Babá | configurado, `active=false` | **0 execuções** |

Estático sozinho reportaria dois flows atendendo o item. Runtime sozinho não
mostraria que o NAT&CO existe configurado. Juntos: "um roda, o outro é carcaça".

### Cuidado de eficiência (obrigatório)

Esse producer tem **11.553 registros** em `x_nasm_hr_case`, e só **4** têm
contexto de flow sobrevivente — o `sys_flow_context` é podado.

Percorrer registro a registro custou 230+ chamadas para **um** producer. Com 688
producers isso é inviável. A coleta deve **amostrar os N registros mais
recentes** por producer (20 a 50), não varrer tudo.

E a poda reforça a regra: ausência de execução **não** prova que o flow não roda.

## Panorama de fulfillment na Natura QA

| | |
|---|---|
| Itens ativos | 490 |
| Com `workflow` | 0 |
| Com `flow_designer_flow` | 1 |
| **Sem nenhum dos dois** | **489** |

Praticamente 100% do fulfillment vive em trigger na tabela destino. Tabelas mais
usadas pelos record producers: `x_nasm_hr_case` (151), `x_nasm_finance_case` (43),
`sn_vdr_risk_asmt_task` (34), `x_nasm_mmdo_case` (32), `x_nasm_ptp_case` (27).

## O limite que continua de pé

Quando a condição da trigger **não** cita o sys_id do item (item em outra
instância, ou trigger genérica por categoria), volta a valer o caso fraco:
listar os flows que disparam na tabela como **candidatos**, e cruzar a condição
com o que o script do RP grava. Emitir sempre qual dos dois caminhos foi usado,
para quem lê o JSON saber o grau de confiança.

---

# Como está implementado

Código em `src/catalog/fulfillment.js`, chamado por `collect()`. Saída no JSON:
`triggered_workflows[]` e `triggered_flow_designers[]` em cada item.

Runtime é **opt-in**: `node scripts/extract.js --query "..." --confirm --runtime 50`.
Sem a flag, só o estático (que não custa chamada extra por item).

## Todas as tabelas usadas

| Tabela | Para quê | Como é consultada |
|---|---|---|
| `sc_cat_item.workflow` | workflow legado no campo do item | já vem na coleta base |
| `wf_workflow_version` | `table`, `condition`, `active` reais | `workflowIN<ids>^published=true` |
| `sc_cat_item.flow_designer_flow` | Flow Designer no campo do item | já vem na coleta base |
| `sys_variable_value` | **achar a trigger pelo sys_id do item** | `document=sys_hub_trigger_instance^valueLIKE<id>^ORvalueLIKE<id2>...` |
| `sys_hub_trigger_instance` | o gatilho | `sys_idIN<ids>` → `flow`, `trigger_definition` |
| `sys_variable_value` | inputs do gatilho | `document=sys_hub_trigger_instance^document_keyIN<ids>` → `Table`, `Condition`, `Run Trigger` |
| `sys_hub_flow_base` | nome, `active`, `status`, `sys_class_name` | `sys_idIN<ids>` — **base**, não `sys_hub_flow` |
| `sys_dictionary` | achar o campo de volta da tabela destino | `name=<table>^internal_type=reference^referenceINsc_cat_item,sc_cat_item_producer` |
| `<table_name>` | amostra de registros do item | `<campo>=<item>^ORDERBYDESCsys_created_on`, limit N |
| `sys_flow_context` | execuções reais de flow | `source_recordIN<amostra>` → `name`, `sys_created_on` |
| `sc_req_item` | RITMs do catalog item | `cat_item=<id>^ORDERBYDESCsys_created_on`, limit N |
| `wf_context` | execuções reais de workflow legado | `idIN<ritms>` → `name`, `sys_created_on` |

## Armadilha nova: `sys_hub_flow_snapshot`

`sys_hub_trigger_instance.flow` referencia `sys_hub_flow_base`, e aponta tanto
para o flow vivo (`sys_hub_flow`) quanto para **snapshots**
(`sys_hub_flow_snapshot`) — cópias pontuais do mesmo flow.

Consultar só `sys_hub_flow` fazia metade das entradas voltar sem `active` nem
`status`, e o mesmo flow aparecer duas vezes com sys_ids diferentes.

Correção aplicada: ler de `sys_hub_flow_base` e deduplicar por
**nome + condição + tipo de gatilho**, preferindo o registro cuja
`sys_class_name` é `sys_hub_flow`. O snapshot só entra se não houver o vivo.

Resultado no producer validado: de 4 entradas para 2, com `active` correto.

## O campo `link` — grau de confiança

| Valor | Origem | Confiança |
|---|---|---|
| `item_field` | `sc_cat_item.workflow` / `.flow_designer_flow` | certeza |
| `trigger_condition` | a condição da trigger cita o sys_id do item | certeza |
| `target_table` | só dispara na tabela destino | **candidato** |

Todos os três são emitidos. O `target_table` entra como fallback automático.

## Leitura do resultado

```
EY: Reimbursement of Daycare or Babysitting Assistance   active=true   exec=4
NAT&CO Auxílio Creche e Babá                             active=false  exec=0
```

- `active=true` + `exec>0` → roda, confirmado
- `active=false` + `exec=0` → carcaça, configurada e morta
- `active=true` + `exec=0` → configurado mas sem execução **na amostra**; pode
  ser item pouco usado ou poda do `sys_flow_context`. Não concluir que não roda.

---

# Ajustes que o piloto exigiu (2026-09-17)

Dois piloto rodados na Natura QA revelaram o que a validação num item só não
mostrava. Ambos os ajustes estão no código.

## 1. Fallback `target_table` — não era exceção, é metade da instância

O padrão `item=<sys_id>` na condição da trigger vale no app de RH
(`x_nasm_*`), mas **não** no VRM. O record producer "Doações/Patrocinio"
escreve em `sn_vdr_risk_asmt_charitable_contribution`, e essa tabela **não tem
campo de referência de volta para o catálogo** — logo, nenhuma trigger pode
condicionar no item.

Sem tratar, o JSON saía com fulfillment **vazio** para esse RP, existindo 6
triggers e 11 execuções na tabela.

O fallback roda automaticamente para todo item que tenha `table_name` e
**nenhum** flow achado pelos caminhos exatos:

1. acha as trigger instances com `Table = <table_name>`
2. deduplica por nome + condição + gatilho (as mesmas 6 viraram 2)
3. emite com `link: "target_table"`

Resultado real:

```json
{ "name": "Ey - TPRM -  Flow - EC Contribution",
  "link": "target_table", "active": "true",
  "trigger_condition": "^EQ",
  "executions": { "count": "0", "scope": "table" } }
```

A condição `^EQ` é **vazia** — esse flow dispara em todo registro criado na
tabela. Como só esse RP cria esses registros, na prática ele É o fulfillment.
Mas o dado não permite afirmar isso, e por isso vai como candidato.

## 2. Campo `executions.scope` — item ou tabela

O número de execuções não tem o mesmo significado nos dois casos:

| `scope` | Significa | Quando |
|---|---|---|
| `item` | execuções nos registros **daquele item** | há campo de volta para o catálogo |
| `table` | execuções na **tabela toda** | não há campo de volta |

Sem esse campo, alguém leria "11 execuções" como "11 desse item". Com
`scope: "table"`, sabe que é o total da tabela.

O `scope: "item"` traz também `sample_size` (quantos registros recentes foram
amostrados). O `scope: "table"` usa a Aggregate API com `group_by=name`, então
a contagem é **exata**, não amostrada — uma chamada por tabela.

## 3. ARMADILHA: o campo de volta pode estar na tabela PAI

Esta custou um resultado errado inteiro. Primeira execução dos 18 RTR:
**todos os vínculos exatos com 0 execuções**, sendo que a tabela tinha 152.

Causa: `findBackReference` consultava `sys_dictionary` só com
`name=x_nasm_rtr_case`. O campo não está lá — está em
**`task.x_nasm_hr_item`**, na tabela pai:

```
hierarquia: x_nasm_rtr_case -> task
campo:      task.x_nasm_hr_item -> sc_cat_item_producer
registros com o campo preenchido: 92.540
```

A busca voltava vazia, a amostragem por item era pulada inteira, e tudo saía
com `count: 0`. Com 92.540 registros na tabela e 6.295 só de um producer.

Correção: subir a hierarquia com `tableHierarchy()` e consultar
`nameIN<cadeia>`, preferindo o campo da tabela mais específica quando houver
mais de um. Depois do conserto: **24 entradas com execução real**, contra 13.

> É a **terceira** vez que herança de tabela morde neste projeto —
> `item_option_new.type` (está em `question`), `sys_hub_flow` (a trigger aponta
> para `sys_hub_flow_base`) e agora o campo de volta (está em `task`).
> **Regra: nunca consultar `sys_dictionary` com `name=<tabela>` sozinho.**
> Sempre subir a cadeia de herança.

## Cobertura medida nos 18 record producers do RTR

| | |
|---|---|
| Entradas de fulfillment | 52 |
| Vínculo exato (`trigger_condition`) | 27 |
| Candidato (`target_table`) | 25 |
| Inativas (carcaça) | 2 |
| **Com execução real confirmada** | **24** |

17 dos 18 itens tiveram vínculo exato; 1 caiu no fallback. A mesma rodada
exercitou os dois caminhos.
