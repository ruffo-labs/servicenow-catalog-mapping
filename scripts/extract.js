#!/usr/bin/env node
/**
 * Fase 1 do mapeamento: extrai da Table API (somente GET) e grava o JSON do
 * contrato com os `script_understanding` ainda vazios.
 *
 * Fase 2 (enriquecimento por LLM) fica em scripts/merge-understandings.js.
 *
 * Sem --confirm ele so LISTA o que casou com a query e para, para conferencia.
 * Nunca roda sem query.
 *
 * Uso:
 *   node scripts/extract.js --query "active=true^name=X"
 *   node scripts/extract.js --query "active=true^name=X" --confirm
 *   node scripts/extract.js --name "iphone" --include-inactive
 *   node scripts/extract.js --sys-id a1b2...,c3d4...
 *   node scripts/extract.js --query "category=abc^ORprice>100"
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TableApi } from '../src/tableApi.js';
import { collect, preview } from '../src/catalog/collect.js';
import { build, loadDictionaries } from '../src/catalog/build.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Filtros:
  --catalog <sys_id>        itens de um catalogo
  --category <sys_id>       itens de uma categoria
  --name <texto>            nome contem
  --sys-id <id1,id2>        itens especificos
  --kind item|producer|all  padrao: all
  --include-inactive        inclui inativos (padrao: so ativos)
  --updated-after "YYYY-MM-DD HH:mm:ss"   em GMT
  --query <encoded query>   query crua (tem precedencia; e o modo normal de uso)
  --confirm                 confirma a lista e executa o mapeamento
  --runtime [N]             confirma o fulfillment com execucao real (amostra de N
                            registros recentes por item; padrao 50, desligado sem a flag)
  --refresh-dict            ignora o cache de dicionario e rele da instancia
  --out <dir>               padrao: out/
`);
  process.exit(0);
}

const filter = {
  catalog: typeof args.catalog === 'string' ? args.catalog : undefined,
  category: typeof args.category === 'string' ? args.category : undefined,
  name: typeof args.name === 'string' ? args.name : undefined,
  sysIds: typeof args['sys-id'] === 'string' ? args['sys-id'].split(',').map((s) => s.trim()) : undefined,
  kind: typeof args.kind === 'string' ? args.kind : 'all',
  activeOnly: !args['include-inactive'],
  updatedAfter: typeof args['updated-after'] === 'string' ? args['updated-after'] : undefined,
  rawQuery: typeof args.query === 'string' ? args.query : undefined,
};

const outDir = resolve(process.cwd(), typeof args.out === 'string' ? args.out : 'out');

async function main() {
  const api = new TableApi();
  const log = (m) => console.log(`  ${m}`);

  // active=true sozinho NAO e filtro: seria varrer a sc_cat_item inteira.
  const selective = Boolean(
    filter.rawQuery || filter.catalog || filter.category || filter.name ||
    filter.sysIds?.length || filter.updatedAfter || (filter.kind && filter.kind !== 'all'),
  );
  if (!selective) {
    console.error(`
Query obrigatoria. Nao e permitido varrer a sc_cat_item inteira.
Passe --query "<encoded query>" ou um filtro seletivo (--help).
Ativo/inativo sozinho nao conta como filtro.
`);
    process.exit(1);
  }

  const { buildItemQuery } = await import('../src/catalog/collect.js');
  const query = buildItemQuery(filter);

  // Passo obrigatorio: mostrar o que vai ser mapeado e esperar confirmacao.
  const pre = await preview(api, query);
  console.log(`
Query: ${pre.query}

${pre.total} item(ns): ${pre.items} catalog item, ${pre.producers} record producer
`);
  if (!pre.total) {
    console.log('\nNada bateu com a query. Lembrete: a Table API filtra por ACL em silencio.\n');
    return;
  }

  const line = (r) => `${r.active === 'true' ? ' ' : '!'} [${r.kind === 'Record Producer' ? 'RP' : 'CI'}]` +
    `${r.table_name ? ` ${r.table_name.padEnd(34)}` : ' '.repeat(36)} ${r.name}\n      ${r.sys_id}`;

  // Acima de 40 itens a lista completa vira parede de texto e ninguem confere
  // de verdade: que e justamente o passo obrigatorio da DIRETRIZ #2. Entao
  // resume por tabela destino e joga a lista inteira num arquivo.
  const COMPACT_FROM = 40;
  if (pre.total <= COMPACT_FROM) {
    for (const r of pre.rows) console.log(line(r));
  } else {
    const byTable = new Map();
    for (const r of pre.rows) {
      const key = r.table_name || (r.kind === 'Record Producer' ? '(sem table_name)' : '(catalog item)');
      byTable.set(key, (byTable.get(key) ?? 0) + 1);
    }
    console.log('Por tabela destino:');
    for (const [t, n] of [...byTable].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${t}`);
    }
    const inativos = pre.rows.filter((r) => r.active !== 'true').length;
    if (inativos) console.log(`\n  ${inativos} item(ns) INATIVO(s) na lista`);

    mkdirSync(outDir, { recursive: true });
    const listPath = resolve(outDir, '_preview.txt');
    writeFileSync(listPath, `${pre.query}\n\n${pre.rows.map(line).join('\n')}\n`, 'utf8');
    console.log(`\nLista completa dos ${pre.total}: ${listPath}`);
  }
  if (!args.confirm) {
    console.log(`
Confira a lista acima. Para mapear estes ${pre.total} item(ns), repita o comando com --confirm.
`);
    return;
  }

  console.log('\nValidando campos contra o sys_dictionary desta instancia...');
  const { dictionaries, warnings } = await loadDictionaries(api, log, { refresh: Boolean(args['refresh-dict']) });
  if (!warnings.length) log('todos os campos do contrato existem nesta instancia');

  console.log('\nColetando...');
  const runtimeSample = args.runtime === true ? 50
    : typeof args.runtime === 'string' ? Math.max(1, Number.parseInt(args.runtime, 10) || 50)
    : 0;
  const collected = await collect(api, filter, log, { runtimeSample });

  if (!collected.items.length) {
    console.log('\nNenhum item bateu com o filtro. Confira o filtro e as permissoes de leitura.');
    console.log('Lembrete: a Table API filtra por ACL em silencio.\n');
    return;
  }

  const { json, pendingScripts, scriptIndex } = build(collected, dictionaries);

  // Cache por hash: script identico (copia-e-cola) ou rodada repetida nao volta pro LLM.
  const cachePath = resolve(process.cwd(), '.cache/script-understandings.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const fresh = pendingScripts.filter((s) => !cache[s.hash]);
  const totalRefs = Object.keys(scriptIndex).length;

  mkdirSync(outDir, { recursive: true });
  const mapPath = resolve(outDir, 'catalog-map.json');
  const pendingPath = resolve(outDir, '_scripts-pending.json');
  writeFileSync(mapPath, JSON.stringify(json, null, 4), 'utf8');
  writeFileSync(pendingPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    item_query: collected.itemQuery,
    index: scriptIndex,
    scripts: fresh,
  }, null, 2), 'utf8');

  const bytes = fresh.reduce((n, s) => n + s.script.length, 0);
  console.log(`
Resultado
  itens               ${json.itens.length}
  chamadas HTTP       ${api.client.requestCount}
  variable sets       ${json.variable_sets.length}
  user criteria       ${json.user_criteria.length}

Scripts
  ocorrencias         ${totalRefs}
  unicos              ${pendingScripts.length}   (dedupe por hash)
  ja em cache         ${pendingScripts.length - fresh.length}
  a explicar agora    ${fresh.length}   (~${Math.round(bytes / 4)} tokens de entrada)

  ${mapPath}
  ${pendingPath}
`);

  if (fresh.length) {
    console.log(`Proximo passo: fase 2 em lotes retomaveis
  node scripts/next-batch.js --size 50
`);
  } else {
    console.log(`Nada novo para explicar: rode direto:
  node scripts/merge-understandings.js
`);
  }
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}\n`);
  process.exit(1);
});
