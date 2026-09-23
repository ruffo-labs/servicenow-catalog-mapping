# Runbook — como rodar um levantamento

Passo a passo completo. Assume `.env` já preenchido (ver `README.md`).

> **Nada em `out/` é sobrescrito.** Cada execução carimba o nome com
> `YYYY-MM-DD_HH-MM-SS`, e os comandos seguintes acham sozinhos o arquivo mais
> recente. Para trabalhar num levantamento antigo, aponte o caminho na mão
> (`--map`, `--related`).

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
tabela destino, e a lista completa vai para `out/_preview_<carimbo>.txt`.

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
| `--volume` | conta os chamados já abertos por item (total, 12m, 90d). Exato, via Aggregate API, 0 token |
| `--out <dir>` | separa a saída por fatia (`out/tax`, `out/ptp`...) |
| `--refresh-dict` | relê o dicionário da instância (use depois de mudança de estrutura) |
| `--help` | os demais filtros (`--catalog`, `--category`, `--name`, `--sys-id`, `--kind`) |

## 4. Objetos da tabela destino (opcional, 0 token)

Notificações, SLA/OLA, reports e portais das tabelas onde os record producers
gravam. Roda **depois** do extract, lendo o `catalog-map.json` pronto:

```bash
node scripts/extract-related.js --out out/consolidado            # confere o recorte
node scripts/extract-related.js --out out/consolidado --confirm  # coleta
```

Sem `--confirm` mostra o recorte (tabelas e contagens) para conferência. O
recorte inclui as tabelas de **tarefa** do mesmo escopo, porque é onde moram
os OLA. Sai em `related-map.json`. Ver `docs/related-objects.md`.

> **Rode isto ANTES da fase 2.** O `extract-related` regrava o
> `related-map.json` com os scripts em branco; se ele vier depois do
> `merge-understandings`, as condições avançadas das notificações voltam
> nulas no arquivo final. Se acontecer, é só rodar o `merge-understandings`
> de novo — ele sabe preencher nos dois arquivos.

## 5. Fase 2 — explicar os scripts, em lotes retomáveis

```bash
node scripts/next-batch.js --size 50
#   → ler out/_scripts-batch.json e explicar cada script
#   → escrever out/_scripts-understood.json  { "<hash>": "explicação" }
node scripts/merge-understandings.js out/<fatia>
```
Repetir até `next-batch` dizer que acabou. Ele lê as **duas** filas — a do
catálogo e a dos relacionados — e o `merge-understandings` preenche os dois
arquivos, achando sozinho a rodada mais recente e o par certo de cada uma.

As regras de como explicar (incluindo onde parar numa chamada GlideAjax) estão
em `docs/script-understanding.md`.

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

## 6. Um arquivo só (opcional, último passo)

```bash
node scripts/merge-related.js out/consolidado
```

Pega o `catalog-map` e o `related-map` mais recentes da pasta e grava um
**terceiro** arquivo, `catalog-map-completo_<carimbo>.json`. As duas entradas
ficam intactas — por isso não existe cópia de segurança nem `--undo`: o
original continua lá para comparar.

Para juntar arquivos específicos em vez dos mais recentes:

```bash
node scripts/merge-related.js out/consolidado --map <arq> --related <arq>
```

Ele recusa juntar um `related-map` gerado de **outro recorte** — confere se os
itens do escopo estão no mapa antes de escrever.

É o último passo porque consome o estado final dos dois arquivos.

## 7. Conferir

Um comando só, que acha a rodada mais recente sozinho:

```bash
node -e "
import('./src/outFiles.js').then(async ({newestRun})=>{
const fs=require('fs'), dir='out/consolidado';
for (const base of ['catalog-map','related-map','catalog-map-completo']) {
  const f=newestRun(dir,base); if(!f) continue;
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  let n=0,t=0; const scan=o=>{ if(o&&typeof o==='object'){
    if('script_understanding' in o){ t++; if(o.script_understanding===null) n++; }
    for(const k in o) scan(o[k]); } };
  scan(j);
  const v=(x)=>(j.itens||[]).filter(i=>i.conversational?.veredito===x).length;
  console.log(require('path').basename(f));
  console.log('   scripts', t, '| pendências', n);
  if (j.itens) console.log('   itens', j.itens.length, '| com volume', j.itens.filter(i=>i.volume).length,
    '| apto', v('apto'), 'ressalvas', v('com_ressalvas'), 'bloqueado', v('bloqueado'));
  if (j.notifications) console.log('   notificações', j.notifications.length,
    '| SLA/OLA', (j.slas||[]).length, '| reports', (j.reports||[]).length);
}});"
```

**Pendências tem que dar zero** em todos.

**Desconfie de número redondo demais ou vazio demais.** Vários bugs deste
projeto apareceram assim, não em teste: `0 execuções` numa tabela com 92.540
registros, `0 OLA` em 22 tabelas, um órfão herdando 200 triggers alheias.

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
