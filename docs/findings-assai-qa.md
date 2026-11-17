# Achados — Assaí QA (catálogo de RH)

Levantamento de **138 catalog items ativos** do catálogo `494f32941bcf249032822170f54bcb02`
em `assaiqa.service-now.com` (2026-09-30). Nenhum record producer.
**Nada foi alterado na instância** — isto é levantamento, ver DIRETRIZ #1.

O arquivo irmão `findings.md` cobre a Natura QA. Aqui ficam só os achados desta
instância. Origem de cada um: `script_understanding` no `catalog-map`; o nome do
script é o da instância.

## Números do levantamento

| | |
|---|---|
| Itens | 138 (todos catalog item) |
| Variáveis / choices | 2.851 / 15.253 |
| Variable sets em uso / user criteria em uso | 103 / 24 |
| Scripts: ocorrências → únicos | 554 → 286 (**-48%** por dedupe) |
| Fase 2 | 286 explicados, 0 pendências, 6 lotes |
| Fulfillment | 138 entradas, todas ativas; 83 com execução confirmada |
| Por tipo de ligação | 109 workflow (`item_field`), 28 Flow Designer (`item_field`), 1 trigger (`trigger_condition`) |
| Chamados no recorte (RITM) | 1.117.723 — top 10 concentra 59,0% |
| Itens sem chamado nos últimos 12 meses / 90 dias | 1 / 11 |
| Conversacional | 0 aptos, 29 com ressalvas, 109 bloqueados |
| JSON | 19,1 MB |

O volume foi conferido por contagem direta: o item de maior volume
(Vale-transporte, Gestor/RH Ponta) tem 134.781 RITMs na Aggregate e na contagem
direta; na janela de 12 meses o mapa dá 36.018 e a contagem feita minutos depois
deu 36.017.

## Objetos ligados a sc_req_item

Catalog item comum não tem tabela destino; a tabela é sempre `sc_req_item` (ver
`docs/related-objects.md`). Como ela é compartilhada por todos os catálogos da
instância, a maior parte do que foi coletado é genérico:

| | Coletado | Citam algum dos 138 itens |
|---|---|---|
| Notificações | 106 (85 ativas) | 3 |
| SLA | 695 | 7 |
| OLA | 77 | 4 |
| Reports | 4.346 (8.726 compartilhamentos) | 211 |
| Portais | 4 (expõem o catálogo RH e/ou o Service Catalog padrão) | — |

Para saber o que é específico destes itens, use `cited_items[]`. `sc_task`
(4 notificações, 3 SLA, 11 OLA, 578 reports) e `sc_request` ficaram de fora por
decisão. Um dos 138 itens também está vinculado ao catálogo Service Catalog padrão
pela m2m `sc_cat_item_catalog`.

## Opções das variáveis que apontam para service_offering (`reference_choices`)

Rodada de 2026-10-15 (mesmos 138 itens; a instância mudou desde 09-30: 104 variable
sets contra 103, 561 scripts contra 554, 6 novos explicados).

| | |
|---|---|
| Itens com `reference_choices` | 137 de 138 (o que falta, *Manutenção de grupos ServiceNow*, não tem variável de referência nem oferta ligada) |
| Variáveis por origem | set `RH Default` 108 itens, set `Ofertas de serviço (O que deseja?)` 26, própria do item 3 |
| Blocos por origem das opções | 135 por `u_catalog_items` (qualificador em script, candidato), 2 por `reference_qual` (filtro declarado, certeza) |
| Opções por item | mínimo 1, mediana 3, máximo 45 (Vale-transporte, Gestor/RH Ponta) |
| Status das opções (somando blocos) | 384 Operacional, 135 Não operacional, 89 Desativado |

**Atenção ao ler:** nos blocos por `u_catalog_items` entram também as ofertas desativadas e
não operacionais — no SOC, 17 das 20. O dono do ambiente confirmou que o script do
formulário filtra pelo campo dos itens de catálogo, mas **não** foi medido se ele também
filtra por status. Para listar só o que o formulário provavelmente mostra, filtre por
`operational_status_label = Operacional`.

### Regra de ambiente e armadilha da `service_offering`

Tirado dos docs gerais (que descrevem só o mecanismo). Específico desta instância:

- A regra em `INSTANCE_RULES` é do host `assaiqa.service-now.com`: tabela
  `service_offering`, campo de ligação `u_catalog_items` (Glide List de `sc_cat_item`).
  Qualificadores em script vistos: `AssaiUtils.CSDMGetOfferings*` (não lidos).
- `u_catalog_items` e não `u_catalog_item`: de 7.133 ofertas, 583 estão ligadas a mais de
  um item (máximo 9), 143 têm a lista vazia e em 133 o `u_catalog_item` (único) nem está
  na lista. Há item com 833 ofertas ligadas na instância inteira; no recorte do RH o
  maior tem 45.
- Status das ofertas (valores do choice): 1 Operacional, 2 Não operacional, 6 Desativado.
- Medição de 2026-10-15 que sustenta a armadilha (Aggregate e keyset errados em
  silêncio; offset e `X-Total-Count` certos): Aggregate sem filtro devolveu 2 onde há
  7.133; com `u_catalog_itemsLIKE<item>` devolveu 1 onde a Table API traz 12;
  `queryAll` sem filtro devolveu 1.396 linhas e 661 únicas; com `u_area=rh`, 681 linhas
  e 397 únicas, quando o total é 721.
- Fora do recorte por decisão: `sc_task` tem 4 notificações, 3 SLA, 11 OLA e 578 reports.

### SLA em `sc_req_item` (medido em 2026-11-17)

Estrutura geral em `docs/sla.md`; aqui só os números desta instância.

| | |
|---|---|
| Definições na `contract_sla` | 3.417 (2.855 SLA, 537 OLA, 25 Underpinning contract) |
| Em `collection=sc_req_item` | 785 (645 ativas). O `related-map` reaproveitado tem 781: 695 SLA, 77 OLA e 9 Underpinning contract |
| Em `collection=task` / `sc_request` | 0 / 0 — o casamento exato de `collection` não perde definição de tabela pai aqui |
| Em `collection=sc_task` | 14 (3 ativas) |
| Motor | 3.395 com `workflow`, 22 com `flow`, nenhuma com os dois nem sem nenhum |
| `condition_class` preenchido / `adv_condition_type` ≠ `none` | 4 / 3 — comportamento parcialmente fora das seis condições |
| `task_sla` (execuções) | 18.270.623 registros |

A diferença de 4 definições (785 contra 781) não foi investigada; o mais provável é que
sejam definições criadas depois de 2026-09-30, quando o `related-map` foi coletado.

## Bugs prováveis em script

### `ALP - Show Label Message 07/12` — data no comentário diverge do código
O comentário diz que o kit material escolar só pode ser pedido até 07/12/2025 e
a referência é 08/12/2025, mas o código usa `new Date(2026, 11, 14)` — 14/12/2026.
Um dos dois está errado.

### `CSA - Hide Acompanhar Solcitação` (`follow_request_no`) — placeholder no lugar do sys_id
Compara o retorno de `getCatalog` com a string literal `'projetoRH.sys_id_catalog'`;
a comparação com o sys_id real do catálogo está comentada. Pelo que o script
mostra, a variável nunca aparece por esse caminho.

### `CSA - Validação CPF Candidato` — variável `fields` nunca declarada
Chama `fields.forEach(...)` logo no início, e `fields` não é declarada no script.
Tende a dar erro de execução antes da validação do CPF.

### `CSA - A isenção é para o dependente?` — precedência
`dependente == ('No' || 'Não')` avalia só `'No'`. Com o valor `'Não'` (português)
cai no ramo de dependente e o rótulo de `rh_n_carteirinha` sai errado.

### `CSA - Block Submit OnChange2` — bloqueio que se desfaz
Agenda dois `setTimeout` de 500 ms, um gravando `block='true'` e outro
`block='false'`. Disparam no mesmo instante; o valor final tende a ser `false`.

### `CSA - Valida Cordao` e `CSA - Valida Suporte`
`g_form.setValue('rh_badge_cord_quantity')` e `...support_quantity` sem segundo
argumento, quando a quantidade pedida passa do estoque. A intenção era provavelmente
limpar o campo.

### `ALP - Verify Acompanhar Solicitação` (variante `fa6b2f0d`)
Compara o valor com `g_form.getValue('follow_request')` — o próprio campo em que
o script está — em vez de `requested_for`, que é o que a mensagem diz proteger. A
variante `f9dcae08` compara com `requested_for`.

### `ALP - OnChange User Fields by CPF` e `by Matricula` (set com prefixo `rhvs_`)
A regra de leitura/obrigatoriedade consulta `not_found_collaborator_vs`, sem o prefixo
`rhvs_` que o resto do script usa (`rhvs_not_found_collaborator_vs`). Se a variável com o
nome sem prefixo não existe nesse set, a condição nunca é verdadeira.

### `errorTotalpass`
Grava a flag `bloquearEnvio` mas o script não tem `onSubmit`. O bloqueio efetivo
está em `bloquearSubmit`.

## Containers e configuradores de variável

Rodada de 2026-10-27, 2.868 variáveis. Tipos de layout: 153 Início do Contêiner,
108 Divisão, 155 Final, 8 Pausa. `layout` dos containers: 317 `normal`, 94
`2across`, 5 `2down`. `variable_width` está vazio em quase todas e `visibility` é
`1` em todas — lido da instância, não interpretado.

**Candidato, não confirmado:** containers que não fecham dentro do próprio dono.
O item *Crachá (Gestor/RH Ponta)* tem 5 inícios e 6 finais; o variable set
*Colaborador ou Dependente - RH* tem 1 final e nenhum início. Pode ser um container
aberto no item e fechado no set (o set é compartilhado) — o que seria frágil —, ou
sobra de variável. Só abrindo o formulário no portal para saber.

## Scripts de variável e de UI policy

Antes desta rodada o mapa não lia `script_true`/`script_false` da UI policy nem
`read_script`/`post_insert_script`/`save_script` da variável. Lidos: 7.163
ocorrências, mas **6.597 eram texto-padrão** (comentário-modelo do `save_script` em
1.944 variáveis e `function onCondition() {}` vazio em 4.653 slots de policy) e foram
descartados. Sobraram 5 de UI policy com código (`ALP - Clear Value Data`,
`ALP - Informações do Solicitante`); nenhuma variável tem script próprio.

## Duplicação e manutenção

- **Validação de código de função** (`ALP - Função`, `CSA - Função Atual`,
  `CSA - Função Nova`): 20 scripts, cada um com uma **lista fixa de códigos
  dentro do código**, de 100 a 1.263 números. As listas diferem entre as
  variantes, então o mesmo código passa em um item e falha em outro.
- **Validação de CPF**: 16 cópias (uma por campo). **Telefone**: ~11
  cópias. **CR (centro de resultado)**: ~12 cópias (nomes de CR, com e sem o novo/atual).
- **Checagem de chamado duplicado** em Divergência no Ponto: 8 scripts quase
  iguais, um por variável gatilho e por versão do variable set (`_set` e `_set_2`).
- **sys_ids e datas fixos no código**: gerente regional em `ALP - Set Regional Manager`;
  ofertas em `bloquearSubmit`, `CSA - Block on submit` (montado pela junção de
  duas strings) e `CSA - Impede abertura sem endereço`; janelas de prazo do kit
  material escolar. Trocam de valor entre QA e PROD sem aviso.
- **Scripts de teste ou resíduo**: `Onchange o que deseja?` só faz `console.log`;
  `ALP - Organização` repete `addOption('--')` dezenas de vezes; `ALP - Solicitar Kit
  Ate 07/12 [IGNORE]` está marcado para ignorar mas ainda está no item.

## Governança

- `ALP - Documentacao instance view PROD` e `... QA` são user criteria que decidem
  por nome de instância (`assai` / `assaiqa`). Funciona, mas é regra por ambiente
  dentro de critério de acesso.
- Dois user criteria (`ALP - RH and PS`, `User Criteria - RH - Administradores and PS`)
  fazem o mesmo teste: bloquear quem tem usuário começando com `PS`.

## Conversacional

Nenhum dos 138 é apto. Os bloqueadores, por item (um item pode ter mais de um):

| Código | Itens |
|---|---|
| `client_script_sem_va` — client script ativo sem "VA Supp" | 107 |
| `tipo_nao_suportado` — variável do tipo Custom (14) | 70 |
| `widget` — variável usa widget de portal | 69 |

É avaliação estática contra critérios publicados, não teste no Virtual Agent. Ver
`docs/conversational.md`.
