# Regras do `script_understanding`

Fase 2 do pipeline. O LLM lê `out/_scripts-pending.json` e escreve
`out/_scripts-understood.json` no formato `{ "<hash>": "explicação" }`.

## Economia de token (importante)

A fila é **deduplicada por hash do script**. Script copiado-e-colado entre 30
itens aparece uma vez só, com `used_by` listando todos os registros que o usam.

Além disso, todo entendimento vai para `.cache/script-understandings.json`,
chaveado pelo mesmo hash. Numa segunda rodada o `extract` já desconta o que
está em cache — script que não mudou **nunca** volta para o LLM. O
`extract` imprime quantos sobraram e a estimativa de tokens de entrada antes
de você decidir seguir.

O script cru **não** entra no JSON final — este levantamento é para entender o
catálogo, não para versionar código.

## O que explicar

- O que o script faz, em português, em prosa curta.
- Qual variável dispara (`onChange` de quê) e o que ele altera.
- Condições relevantes: quando entra, quando sai cedo (`if (isLoading) return;`).

## Onde parar — regra do AJAX

Se o script chama um Script Include via `GlideAjax` (ou qualquer outro script),
**não vá ler o outro script**. Registre:

- que ele chama, e o nome do Script Include / método;
- o que ele faz com o **retorno** (em qual variável grava, como usa).

> Exemplo: "No onChange de `location`, chama o Script Include
> `LocationUtilsAjax.getManager` via GlideAjax e preenche a variável
> `approver` com o sys_id retornado. Se o retorno vier vazio, limpa o campo."

Isso vale para todos os tipos de script do contrato.

Origens que entram na fila: Catalog Client Script (de item e de variable set),
os três scripts do Record Producer (`script`, `post_insert_script`,
`save_script`) e script de User Criteria. Todas chaveadas pelo hash do
conteúdo — o `index` do arquivo pending faz a volta
`<tabela>:<sys_id>:<campo>` → hash (o campo entra na chave porque um mesmo
record producer tem até três scripts).

## Record Producer

Na maioria dos casos o script do RP é só mapeamento de variável para coluna da
tabela destino. Nesses casos a explicação é justamente isso: quais variáveis
caem em quais campos. Se além disso ele chamar outro script, aplica-se a mesma
regra do AJAX — cita e segue.

## O ciclo em lotes (obrigatório em levantamento grande)

462 scripts únicos não cabem numa passada — medido em 151 record producers:
~94k tokens de entrada. O ciclo é retomável, com o cache como estado:

```bash
node scripts/next-batch.js --size 50     # corta o próximo lote
#   -> explicar out/_scripts-batch.json
#   -> escrever out/_scripts-understood.json  { "<hash>": "explicação" }
node scripts/merge-understandings.js     # injeta no JSON e grava no cache
```

Repetir até `next-batch` dizer que não sobrou nada. Se parar no meio, a próxima
chamada continua de onde estava — o que já foi explicado está no cache.

`next-batch` mostra a barra de progresso, o custo estimado do lote e quantas
passadas ainda faltam.
