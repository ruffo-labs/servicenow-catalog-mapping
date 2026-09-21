# Economia de token

Números medidos no levantamento de 248 record producers da
`instancenaturasnqa` (2026-09-21). Nada aqui é estimativa de projeto — tudo foi
contado.

---

## O princípio: só a fase 2 custa token

| Fase | O que faz | Custo |
|---|---|---|
| 1 — extração | Node puro: coleta, dedupe, fulfillment, montagem do JSON | **0 token** |
| 2 — explicação | LLM lendo scripts e escrevendo `script_understanding` | proporcional aos **bytes de script único** |

Consequência prática: **quantidade de chamadas HTTP não tem relação com token.**
Você pode fazer 200 chamadas ingênuas ou 18 em lote — o custo em token é o mesmo
zero. A batelada existe por tempo de parede e consistência, não por economia.

O que dirige o custo é **quantos scripts distintos** entram no recorte — não
quantos itens.

## Medições

### Fase 1 — 248 itens

```
chamadas HTTP        1.018
tempo de parede      ~3 min
tokens               0
```

### Fase 2 — primeira execução

```
ocorrências de script    1.291
únicos (dedupe hash)     1.016   (-21%)
tokens de entrada        ~186k
lotes de 50              ~20 passadas
```

### Fase 2 — re-execução do mesmo recorte

```
já em cache    1.012 de 1.016
a explicar         4
tokens          ~437
```

## O que já está implementado e funciona

### 1. Dedupe por hash de conteúdo — economia medida: 21%

Scripts idênticos (copy-paste entre itens) são explicados uma vez. O campo
`used_by` lista todos os registros que compartilham aquele hash.

Ressalva honesta: eu previa um corte maior. Em catálogos com muito copy-paste
(RTR) o dedupe chega a 23%; na base inteira ficou em 21%. Os scripts da Natura
são majoritariamente distintos.

### 2. Cache persistente por hash — economia medida: ~100% em re-execução

`.cache/script-understandings.json`, sem TTL (conteúdo mudou → hash mudou →
reexplica). É também o estado do progresso: parar no meio de um levantamento
não perde nada.

**Efeito colateral importante:** fatiar um levantamento não custa nada a mais.
Sobreposição entre catálogos vira cache hit na fatia seguinte.

### 3. Cache de dicionário — economia medida: 58 chamadas por execução

`.cache/dictionary-<host>.json`, TTL de 7 dias, por instância. Não economiza
token (fase 1 é grátis), mas derruba a execução de 78 para 20 chamadas e corta
o tempo de espera. `--refresh-dict` força releitura.

### 4. Lotes retomáveis

Não economiza token, mas torna viável o que não cabe numa passada. Sem isso, um
levantamento de 951 scripts simplesmente não fecha.

---

## O que eu testei e NÃO vale a pena

Registro o resultado negativo para ninguém refazer o teste.

### Normalizar espaços antes do hash — ganho: 2,8%

```
dedupe exato (hoje)        723 únicos   563 KB   144k tokens
+ normalizando espaços     703 únicos   549 KB   141k tokens
```

20 scripts a menos. Não paga a complexidade de guardar a forma original para
exibir.

### Normalizar dígitos nos identificadores — ganho: 4,3%

```
+ normalizando dígitos     692 únicos   532 KB   136k tokens
```

Agruparia os 8 `Set Country OnChange` que só diferem em
`vs_which_sub_company_N`. Mas 8k tokens não pagam o risco: dois scripts que
diferem num número podem diferir em **regra de negócio** (um teto de 100 e outro
de 1000 não são o mesmo script), e a explicação sairia errada.

**Conclusão: o dedupe exato por conteúdo é o ponto certo.** Mais agressivo que
isso troca token por precisão, e precisão é o produto aqui.

---

## O que vale implementar (não feito)

### 1. Truncar scripts longos na fila — economia estimada: 15k de 144k (10%)

```
scripts > 3000 chars:  15  →  86 KB  →  22k tokens
se truncados em 2000:              →   8k tokens
```

Quinze scripts consomem 15% do orçamento. E são justamente os que menos precisam
ser lidos por inteiro: os maiores são blocos `if` repetidos dezenas de vezes
(`EY: Set subcompany RTR`, 9,8 KB, é o mesmo par setDisplay/setMandatory para
sete variáveis, repetido por lista de formulário).

Implementação: `--max-chars N` no `next-batch`, truncando com marcador explícito
(`[...truncado em N de M chars]`) para o LLM saber que não viu tudo e poder
pedir o resto quando precisar.

**Hoje isso é feito na mão** (ver `docs/runbook.md`, "Como ler o lote"). Encodar
no script elimina o erro de operação.

### 2. Agrupar por nome na fila — ganho: consistência e tokens de saída

Medido: **176 scripts em 61 famílias de mesmo nome** mas corpo diferente.

```
10x  EY: Clear Fields                  (2,6k tokens)
10x  EY: Show error message onChange   (1,1k tokens)
 9x  EY: Show error message onSubmit   (0,7k tokens)
 8x  EY: Máscara de Moeda              (1,9k tokens)
 6x  EY: Fill number of days License   (2,4k tokens)
```

Se o lote ordenar por `label`, as variantes chegam juntas e a explicação sai
consistente ("variante do irmão, mudando o campo X") em vez de repetir a
descrição inteira. Economia maior na **saída** que na entrada, e o JSON fica
melhor de ler.

Implementação: ordenar `scripts` por `label` no `next-batch`. Uma linha.

### 3. Pular scripts inúteis automaticamente

Achados no levantamento: um script de 8,8 KB **inteiramente comentado**, outro
que só contém `alert('test')`. Detectar corpo 100% comentado ou com menos de N
caracteres de código efetivo, e emitir uma explicação automática, sem LLM.

Ganho pequeno em token; ganho real em não desperdiçar atenção.

---

## Orçamento por tamanho de recorte

Regra prática derivada dos dados (~3 scripts únicos por item, ~190 tokens por
script):

| Itens | Scripts únicos | Entrada | Lotes de 50 |
|---|---|---|---|
| 20 | ~60 | ~12k | 2 |
| 50 | ~150 | ~30k | 3 |
| 150 | ~460 | ~90k | 10 |
| 250 | ~1.000 | ~190k | 20 |

Varia muito com o catálogo: o de sustentação ServiceNow tinha 2 scripts em 30
itens; o de RH tinha 574 em 148. **Sempre rode a fase 1 primeiro** — ela dá o
número exato de graça.
