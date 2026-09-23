# Achados do levantamento

Problemas encontrados na leitura dos 1.016 scripts dos 248 record producers da
`instancenaturasnqa` (2026-09-21). **Nada foi alterado na instância** — isto é
levantamento, ver DIRETRIZ #1.

Ordenado por impacto. Cada item traz o nome do script e o catálogo, para
localizar na instância.

---

## Corrompe dado ou muda comportamento

### `EY: Show v_attachment_3` — Hispanic
`onSubmit` que grava a string literal `'TESTE'` por cima do campo de
detalhamento preenchido pelo usuário. O chamado chega ao atendimento com
"TESTE" no lugar da descrição real. Está **ativo**. O nome do script não tem
relação com o que ele faz.

### `EY: Job Profile 10092` e `EY: Job Profile 10410` — OTC Sales
User criteria com precedência de `OR`/`AND` sem parênteses, e três
`indexOf(...) == -1` ligados por `OR` para testar variações do título. Como um
título não pode ser igual às três formas ao mesmo tempo, esse trecho é
praticamente sempre verdadeiro. **Efeito provável: aprova qualquer usuário
Natura de COL/CHL/PER/BRA sem filtrar o cargo** — justamente o que deveria
filtrar. Logo abaixo há um bloco comentado com a lógica inversa, sugerindo que
inverteram a condição.

### `EY - Set Companies OnLoad` — PTP
```js
if (formsAvon.indexOf(formAtual > -1))   // errado
if (formsAvon.indexOf(formAtual) > -1)   // correto
```
O `> -1` está **dentro** do `indexOf`. Devolve `-1`, que é verdadeiro num `if`.
A opção "Avon" é adicionada em **todos** os formulários, não só nos dois da
lista.

### Record producer de rescisão — Hispanic
As linhas que gravariam `x_nasm_hr_item` e `item` com o `sysparm_id` estão
**comentadas**, diferente de todos os irmãos do catálogo. Sem esse campo, as
triggers de flow que condicionam no item não identificam a origem do registro.

### `Solicitar Rescisão Complementar` e `Solicitar troca de escala coletiva` — HTR
Leem o perfil em `x_nasm_hr_profile` pela variável do colaborador **mas definem
`requested_for` como o usuário logado**. A leitura do perfil não é usada. Se a
intenção era abrir em nome do colaborador informado, o chamado vai para a
pessoa errada.

### `Emissão de Notas Fiscais de Industrialização` — TAX
Força `requested_for` e `opened_by` para o usuário externo genérico **sem
verificar se quem abriu é interno** — diferente dos irmãos do mesmo catálogo,
que ramificam. Todo chamado deste item fica no nome do usuário genérico.

---

## Visível ao usuário final

### Seis `alert()` de depuração ativos

| Script | Catálogo | Conteúdo |
|---|---|---|
| `EY: Hide legedas` | Hispanic | `alert('test')` — resto do corpo comentado |
| `EY: Teste2` | Hispanic | `alert('teste')` na abertura |
| `EY: Monitor Children exclusion` | Hispanic | `alert('EXCLUIDO')` ao remover filho |
| `EY: teste reference` | HTR | mostra valor de campo na abertura |
| `EY: Adjust to original employee_name` | HTR | `alert('ENTREI')` — resto comentado |
| `ACN: Fill the "Employee" field` | HTR | `alert('oi')` a cada mudança |

Mais dois casos de `alert()` usado como comunicação legítima onde
`addInfoMessage` ou modal seriam adequados: `EY: Aprovador != de aberto port`
(com texto `teste1`) e `NAT&CO Informar janela de processamento`.

### `EY: hide submit button` — HTR
`onSubmit` que força `result = false` e redireciona para uma URL do Workday. **O
item nunca cria chamado** — serve de atalho para outra plataforma. Se alguém
contar esse item como demanda atendida, o número está errado.

### `EY: Approver PopUp` — PTP
Exibe aviso de mudança de processo com `expirationDate = '2026-07-24'` cravado.
A data já passou; vale conferir se o popup ainda deveria aparecer.

---

## Falha silenciosa

### `setDisplay`/`setVisible` com string em vez de booleano — 5 ocorrências
```js
g_form.setVisible('v_compensation_type, false');   // arg dentro da string
g_form.setDisplay('assist_odonto_title', 'false'); // string 'false' é verdadeira
```
O campo **não** é escondido — e pode acabar exibido. Nenhum erro no console.
É o padrão de erro mais repetido do levantamento.
Ocorrências: `EY: Hide fields VS` (OTC Sales), `EY: Set the variables invisible`
(PTP), `EY: Hide filde`, `EY: Hide fields`, `EY: Hide Dental Title` (HTR).

### `g_form.clearMessages;` sem parênteses — 2 ocorrências (Hispanic)
Referencia a função em vez de executá-la. As mensagens não são limpas.

### `EY: Place Holder Value` — PTP
Uma segunda `function onLoad()` declarada **dentro** da primeira, com campo
genérico `field_name` — trecho de exemplo colado por engano.

### `Autofill Code LC116 - Validate Currency` — PTP
8,8 KB **inteiramente comentados**. Código morto anexado ao formulário.

### `EY: Eligibilities Informative` — HTR
Define `checkCondition()` mas **nunca a chama** — diferente dos irmãos, que
começam com `checkCondition();`. O critério não retorna resultado.

### `EY: Validate the form for the area field` — PTP
Declara `sysId` e `sysId_2` recebendo o mesmo `g_form.getUniqueValue()` e
compara cada uma com um sys_id diferente usando `AND`. Funciona por acidente; a
intenção escrita não é a executada.

### `EY: Check if reach max row` — RTR
`onSubmit` que tenta desabilitar o botão de adicionar linha — mas nesse momento
as linhas já existem, e o script não faz `return false`. **Não bloqueia nada.**

---

## Validação

### CPF/CNPJ sem dígito verificador — maioria dos catálogos
Só o **PTP** calcula os dígitos verificadores. Todos os demais conferem apenas
formato, então qualquer sequência de 11 ou 14 dígitos passa.

### Ponto sem escape na regex de CPF — HTR
```js
/^(([0-9]{3}.[0-9]{3}.[0-9]{3}-[0-9]{2}))$/
```
O `.` não escapado casa **qualquer** caractere: `123x456y789-00` é aceito.
A versão correta existe no mesmo catálogo (`EY: CPF Validation Regex`, com
`\.`) — as duas convivem.

### Comparações com caixa divergente
`vs_did_you_find_the_cost_center` é comparado com `'No'` num script e `'no'`
noutro, **no mesmo formulário**. Um deles é o `onSubmit` que bloqueia o envio —
se o valor real for minúsculo, a trava não pega.

Mesmo padrão em `EY: When hidden or display area field` (PTP): `'Natura'` num
script, `'natura'` noutro.

### `parseInt` em comparação de teto — Hispanic
`EY: Check tope to apply onSubmit` compara despesa e teto com `parseInt`,
descartando centavos: 100,99 contra teto de 100 vira 100 contra 100 e passa.

### `registration _adhesion_benefit` — Hispanic
Valor comparado tem um **espaço no meio**. Se a opção real não tiver esse
espaço, a condição nunca casa.

### Scripts sem guarda `if (isLoading)`
`EY: Clear values` e `EY: Clear values change` (Hispanic), `ACN: Verifying if
employee is AVON` (HTR). Disparam durante o carregamento e apagam valores já
preenchidos ao reabrir o formulário.

---

## Governança e acesso

### `EY: Public Vendors Query` — PTP
User criteria que devolve só `gs.isLoggedIn()`. **Qualquer usuário autenticado**
vê o item, sem filtro de país, marca ou perfil.

### `EY: Restricted access` — demo
Sys_id de uma pessoa cravado no script. Quebra silenciosamente quando esse
usuário sair ou for desativado.

### Critérios que dependem do texto do cargo
`Interns` (Hispanic) e `Aoop: Request for Prior Notice of Termination` (HTR)
decidem por `title.includes(...)`. Mudança de nomenclatura de cargo quebra o
critério sem aviso.

### Critérios que filtram por gênero — HTR
`ACN: Request for Maternity Leave` e `ACN: Paternity Leave Request` filtram
`sys_user` pelo campo `gender` numa encoded query. Registro aqui para que a
regra seja uma decisão consciente, não um efeito colateral.

### `EY: Users Colombia- Manager Recursive - v2` — OTC Sales
Chama o Script Include `EY_Users_Chile_Recursive.validateRetailColombia`. O
nome do Script Include diz Chile, o método diz Colômbia. A chamada é
intencional, mas o nome engana.

---

## Duplicação

| O quê | Quanto |
|---|---|
| Scripts com mesmo nome e corpo diferente | **176 em 61 famílias** |
| `EY: Clear Fields` | 10 variantes |
| `EY: Show error message onChange` | 10 variantes |
| `EY: Máscara de Moeda` | 8 variantes |
| `Set Country OnChange` | 8 variantes (uma grava em `vs_country`, as outras em `v_country`) |
| User criteria recursivos de hierarquia | 5 cópias (Benefits, MDM, CSC, TDG, TAX) |
| "Natura Colômbia" como user criteria | 2 implementações em padrões diferentes |
| Validadores de CPF | ao menos 6 implementações distintas |

O padrão dominante é **copiar e ajustar o nome do campo**. Boa parte disso
caberia em Script Includes parametrizados — dois critérios já fazem isso
(`ACN Argentina Users`, `Third Party Users`) e são os mais enxutos do conjunto.

---

# Levantamento dos objetos relacionados (2026-09-21)

Notificações, SLA/OLA, reports e portais das 22 tabelas do escopo. Ver
`docs/related-objects.md`.

## Condição avançada de notificação que nunca executa — 2 ocorrências

`ACN: HTR Send Task Hispanic` e `ACN: HTR Send Task ESignature Hispanic`
(ambas em `x_nasm_hr_case`) têm a mesma condição avançada com **dois defeitos**:

```js
function resqtAssign() {          // declarada como resqtAssign / resqtAsign
    var request = current.parent.request_for;
    var assigned = currend.assigned_to;   // currend, com d
    if (assigned == request) return true;
}
conditionScript();                // chama uma função que não existe
```

Estoura `ReferenceError` antes de atribuir `answer`. A intenção — notificar só
quando o responsável pela tarefa é quem abriu o caso pai — nunca acontece pelo
caminho pretendido. Além disso a função não retorna nada quando os dois são
diferentes.

## Dois catálogos não estão em portal nenhum

`Virtual Agent Search` (159 itens) e `Catálogo hispânico` (45 itens) não
aparecem em `m2m_sp_portal_catalog`. Para o Virtual Agent Search é esperado —
é catálogo de busca do VA, não de portal. **Para o Catálogo hispânico vale
conferir**: são 45 itens ativos sem porta de entrada por Service Portal.

## Onde o OLA mora

Não é achado de defeito, é de topologia, e muda quem procura: as 5 tabelas de
caso têm 454 SLA e **zero OLA**. Os 404 OLA estão nas tabelas de tarefa —
`x_nasm_hr_htr_task` sozinha tem 146. Quem for auditar prazo de atendimento
precisa olhar as duas camadas.

## As 858 definições de SLA/OLA usam Flow Designer, nenhuma usa workflow

`contract_sla.flow` preenchido nas 858, `contract_sla.workflow` em zero. É o
oposto do que se vê nos itens de catálogo desta mesma instância.

---

---

# Volume de chamados e conversacional (2026-09-23)

Contagem exata pela Aggregate API sobre `task.x_nasm_hr_item`. Ver
`docs/conversational.md` e o bloco `volume` em `docs/output-schema.md`.

## Metade dos chamados está em 10 itens

**647.511 chamados** nos 248 itens; o top 10 concentra **49,1%**. Se a
refatoração for por impacto, ela cabe numa lista curta:

| total | 12m | 90d | item |
|---|---|---|---|
| 53.656 | 11.845 | 1.408 | Lançamento de Atestados |
| 46.237 | 13.770 | 1.588 | Lançamento Contábil - Natura + TBS |
| 44.283 | 11.178 | 1.636 | Ajuste de Lançamento de Fornecedor |
| 39.283 | 1.027 | 97 | Realizar reembolso e prestação de contas |
| 32.604 | 12.159 | 1.250 | Consulta de Fornecedores "Externo" |

## O acumulado histórico engana

`Realizar reembolso e prestação de contas` é o 4º maior de todos os tempos
(39.283) e tem **1.027 nos últimos 12 meses** — 97 nos últimos 90 dias.
Priorizar pelo total levaria a refatorar um item que está morrendo. É por
isso que o bloco `volume` grava três janelas, não uma.

## 29 itens ativos nunca receberam um chamado

E outros 4 têm histórico mas zero nos últimos 12 meses. Candidatos naturais
a desativar antes de refatorar qualquer coisa.

## Três itens ATIVOS de fora do recorte, com volume

80 itens fora do mapeamento têm 170.022 chamados nessas mesmas tabelas. 77
são record producers **inativos** — histórico, esperado. Mas três estão
ativos e ficaram de fora porque o filtro do levantamento não cobre o
catálogo deles:

| chamados | catálogo | item |
|---|---|---|
| 7.818 | Catálogo Genérico | **Admissão** |
| 23 | (sem catálogo) | Llamado simples |
| 7 | Catálogo Genérico | Aditivos ao contrato de trabalho |

`Admissão` sozinho tem mais chamados que 240 dos 248 itens mapeados. Vale
decidir se entra num próximo recorte.

## Ninguém configurou conversacional nesta instância

Os campos existem e estão vazios: **zero** itens com
`make_item_non_conversational` ou `turn_off_nowassist_conversation` marcados
nos 759 do catálogo, **9** `conversational_label` preenchidos na instância
inteira (1 no recorte, de 2.982 variáveis) e **nenhum** `topic_block`.

Ou seja: a IA da ServiceNow ainda não foi habilitada para pedir estes itens,
e não é por decisão registrada — é por nunca ter sido configurado.

## O que mais atrapalha o conversacional, em volume

| Achado | Quantidade |
|---|---|
| UI policies com `on_load=true` (a doc pede evitar) | 1.756 de 1.761 |
| Variáveis do tipo Anexo | 309 |
| Variáveis com reference qualifier | 326 |
| Client scripts sem **VA Supported** | 88 de 986 |
| Variáveis do tipo Personalizado / com rótulo | 56 + 9 |
| Variáveis com widget de portal | 62 |
| Itens com mais de 20 perguntas (limite de render inline) | 38 |
| Variáveis com UI Macro | 22 |

O maior item tem **161 variáveis** (`Seguro de Vida Complementar`) — oito
vezes o limite em que a VA deixa de conversar e abre janela.

## Coisas boas que vale preservar

- **PTP** é o único que valida CPF/CNPJ de verdade, e com saída antecipada
  inteligente para fornecedor internacional.
- `EY: Show Msg` (HTR) detecta Portal vs visão nativa antes de agir.
- `EY: Popup alert Return of Vacation` (HTR) usa `g_scratchpad` para não repetir
  o aviso e checa `spModal` antes de chamar.
- `ACN: Date Criteria` (HTR) usa `g_user_date_format` em vez de assumir formato.
- `EY: Get data requested for on load` (OTC) só preenche quando os campos estão
  vazios — não sobrescreve o que o usuário digitou.
- `EY: HTR Manager group` (HTR) é um dos poucos com `try/catch`.
- `EY: Terceiros V2 Pension` (HTR) trata explicitamente o usuário não encontrado.
