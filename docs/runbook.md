# Runbook — como rodar um levantamento

Passo a passo completo. Assume `.env` já preenchido (ver `README.md`).

---

## 0. Antes de tudo: conferir a conexão

```bash
node scripts/test-connection.js
```

Confirma o guard read-only, conta as 15 tabelas do catálogo, imprime o mapa
numérico de `item_option_new.type` **desta** instância e diz se o fulfillment
usa `workflow` ou `flow_designer_flow`.

**Leia a contagem por tabela.** A Table API filtra por ACL **em silêncio** — se
`sc_cat_item` vier com 12 e você sabe que tem 800, é permissão, não filtro.

## 1. Descobrir o filtro (opcional)

```bash
node scripts/explore.js
node scripts/explore.js --catalog <sys_id>
```

Lista catálogos e categorias com sys_id e contagem, quebra por classe e mostra
record producers de amostra. Útil quando o usuário não trouxe a query pronta.

## 2. Preview — OBRIGATÓRIO

```bash
node scripts/extract.js --query "<query do usuário>"
```

Sem `--confirm` ele só lista. Acima de 40 itens vira um resumo agrupado por
tabela destino, e a lista completa vai para `out/_preview.txt`.

**Mostre a lista ao usuário e pergunte se são esses mesmos.** Este passo é a
DIRETRIZ #2 e não se pula, nem com um item só.

O comando recusa rodar sem filtro seletivo. `active=true` sozinho não conta.

## 3. Fase 1 — extração

```bash
node scripts/extract.js --query "<query>" --confirm --runtime 50
```

Zero token. Ao final imprime quantos scripts únicos sobraram para a fase 2 e a
estimativa de tokens — **decida com esse número na mão**, não com estimativa.

Flags úteis:

| Flag | Para quê |
|---|---|
| `--runtime [N]` | confirma fulfillment com execução real (N registros recentes por item; padrão 50). Sem a flag, só o estático |
| `--out <dir>` | separa a saída por fatia (`out/tax`, `out/ptp`...) |
| `--refresh-dict` | relê o dicionário da instância (use depois de mudança de estrutura) |
| `--help` | os demais filtros (`--catalog`, `--category`, `--name`, `--sys-id`, `--kind`) |

## 4. Fase 2 — em lotes retomáveis

```bash
node scripts/next-batch.js --size 50
#   → ler out/_scripts-batch.json e explicar cada script
#   → escrever out/_scripts-understood.json  { "<hash>": "explicação" }
node scripts/merge-understandings.js
```

Repetir até `next-batch` dizer que acabou. As regras de como explicar (incluindo
onde parar numa chamada GlideAjax) estão em `docs/script-understanding.md`.

**Nunca tente a fase 2 numa passada só.** Medido: 951 scripts, ~186k tokens.

### Como ler o lote sem desperdiçar contexto

Leia o arquivo em fatias **sem sobreposição** e trunque scripts longos:

```bash
node -e "
const b=require('./out/_scripts-batch.json');
for (const s of b.scripts.slice(0,35)) {
  console.log('== ' + s.hash + ' | ' + s.label + ' | ' + s.script.length + 'ch');
  console.log(s.script.length>300 ? s.script.slice(0,300)+'\n[...]' : s.script);
}"
```

Depois `slice(35)` — **não** `slice(30)`. Reler o mesmo trecho é desperdício
puro. Só leia um script grande por inteiro quando o trecho truncado não bastar
para descrevê-lo com honestidade.

## 5. Conferir

```bash
node -e "
const j=require('./out/catalog-map.json');
let n=0; const scan=o=>{ if(o&&typeof o==='object'){
  if('script_understanding' in o && o.script_understanding===null) n++;
  for(const k in o) scan(o[k]); } };
scan(j); console.log('pendências:', n);"
```

Tem que dar zero.

---

## Fatiar levantamentos grandes

Acima de ~50 itens, fatie **por catálogo** (é filtrável na `sc_cat_item`;
`table_name` não é, por ser campo da classe filha):

```bash
node scripts/extract.js --query "active=true^sc_catalogsLIKE<cat>" --confirm --runtime 50 --out out/<nome>
```

Vantagens: o usuário revisa em pedaços; se as explicações precisarem de ajuste,
você corrige antes de gastar o resto. E **fatiar não custa nada a mais** — o
cache é global e por hash de conteúdo.

No fim, rode a query completa para o consolidado. Com o cache cheio isso sai por
~0 token (medido: 1.012 de 1.016 scripts vieram do cache).

## Erros que você vai encontrar

| Sintoma | Causa real |
|---|---|
| `400 Pagination not supported` | **limite de URL (~2048 chars)**, não paginação. O lote é calculado por `maxIdsPerQuery`; se aparecer, a lista de campos cresceu |
| Comando não termina nunca | query com `^NQ` em caminho que ainda use keyset. Há trava anti-loop; se disparar, reporte com a query |
| Resposta HTML em vez de JSON | sessão inválida ou usuário sem `snc_platform_rest_api_access`. O cliente converte em `ServiceNowError` |
| Contagens baixas demais | ACL. A Table API filtra em silêncio |
| `0 execuções` com muitos registros | campo de volta pode estar numa tabela PAI — ver a regra de herança no `CLAUDE.md` |
