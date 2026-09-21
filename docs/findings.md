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
