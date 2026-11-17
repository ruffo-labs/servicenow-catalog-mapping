#!/usr/bin/env node
/**
 * Levanta os objetos ligados as TABELAS DESTINO de um mapeamento ja feito:
 * notificacoes, SLA/OLA, reports e portais.
 *
 * Nao refaz a fase 1 do catalogo — le o `catalog-map.json` pronto para
 * descobrir as tabelas e os catalogos. Somente GET, zero token.
 *
 * Uso:
 *   node scripts/extract-related.js --map out/consolidado/catalog-map.json
 *   node scripts/extract-related.js --map out/consolidado/catalog-map.json --confirm
 *
 * Sem --confirm ele so mostra o recorte (tabelas e contagens) para conferencia,
 * no mesmo espirito da DIRETRIZ #2.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { TableApi } from '../src/tableApi.js';
import { loadDictionaries } from '../src/catalog/build.js';
import {
  RELATED_TABLES, discoverScope, previewRelated, collectRelated, buildRelated,
} from '../src/catalog/related.js';
import { timestamp, stampedPath, newestRun, resumoDeRodadas } from '../src/outFiles.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  --map <arquivo>     catalog-map.json de origem (padrao: out/catalog-map.json)
  --out <dir>         onde gravar (padrao: a pasta do --map)
  --confirm           confirma o recorte e coleta
  --refresh-dict      rele o dicionario das tabelas relacionadas
`);
  process.exit(0);
}

// Sem --map, usa o catalog-map mais recente da pasta indicada em --out (ou out/).
const dirPadrao = resolve(process.cwd(), typeof args.out === 'string' ? args.out : 'out');
const mapPath = typeof args.map === 'string'
  ? resolve(process.cwd(), args.map)
  : newestRun(dirPadrao, 'catalog-map');
const outDir = typeof args.out === 'string' ? resolve(process.cwd(), args.out) : (mapPath ? dirname(mapPath) : dirPadrao);

async function main() {
  if (!mapPath || !existsSync(mapPath)) {
    console.error(`\nNao achei catalog-map em ${dirPadrao}. Rode scripts/extract.js primeiro (ou passe --map).\n`);
    process.exit(1);
  }
  const api = new TableApi();
  const log = (m) => console.log(`  ${m}`);

  console.log(`\nOrigem: ${mapPath}`);
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  console.log(`  ${(map.itens ?? []).length} item(ns) mapeado(s)\n`);

  console.log('Descobrindo o recorte...');
  const scope = await discoverScope(api, map, log);

  console.log('\nContando por tabela...');
  const rows = await previewRelated(api, scope);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);

  console.log(`
  ${'TABELA'.padEnd(52)} ${'itens'.padStart(5)} ${'notif'.padStart(6)} ${'SLA'.padStart(5)} ${'OLA'.padStart(5)} ${'report'.padStart(7)}`);
  for (const r of rows) {
    const marca = r.items ? '*' : ' ';
    console.log(`${marca} ${r.table.padEnd(52)} ${String(r.items).padStart(5)} ${String(r.notifications).padStart(6)} ${String(r.sla).padStart(5)} ${String(r.ola).padStart(5)} ${String(r.reports).padStart(7)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(52)} ${String(sum('items')).padStart(5)} ${String(sum('notifications')).padStart(6)} ${String(sum('sla')).padStart(5)} ${String(sum('ola')).padStart(5)} ${String(sum('reports')).padStart(7)}`);
  console.log(`\n  (*) tabela dos itens mapeados (destino de record producer, ou sc_req_item para catalog item comum); as demais sao tarefas do mesmo escopo`);

  if (!args.confirm) {
    console.log(`\nConfira o recorte acima. Para coletar, repita com --confirm.\n`);
    return;
  }

  console.log('\nValidando campos contra o sys_dictionary desta instancia...');
  const { dictionaries, warnings } = await loadDictionaries(api, log, {
    tables: RELATED_TABLES,
    cacheKey: 'related',
    refresh: Boolean(args['refresh-dict']),
  });
  if (!warnings.length) log('todos os campos existem nesta instancia');

  console.log('\nColetando...');
  const collected = await collectRelated(api, scope, log);
  const { json, pendingScripts, scriptIndex } = buildRelated(collected, dictionaries, scope, { sourceMap: mapPath });

  const cachePath = resolve(process.cwd(), '.cache/script-understandings.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const fresh = pendingScripts.filter((s) => !cache[s.hash]);

  mkdirSync(outDir, { recursive: true });
  const stamp = timestamp();
  console.log(`\n${resumoDeRodadas(outDir, 'related-map')} — esta sai com o carimbo ${stamp}`);
  const relPath = stampedPath(outDir, 'related-map', stamp);
  writeFileSync(relPath, JSON.stringify(json, null, 4), 'utf8');

  const pendingPath = stampedPath(outDir, '_related-scripts-pending', stamp);
  writeFileSync(pendingPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_map: mapPath,
    index: scriptIndex,
    scripts: fresh,
  }, null, 2), 'utf8');

  const t = json._scope.totals;
  console.log(`
Resultado
  notificacoes        ${t.notifications}   (${t.notifications_active} ativas)
  SLA                 ${t.sla}
  OLA                 ${t.ola}
  outro tipo          ${t.other}   (Underpinning contract)
  reports             ${t.reports}
  portais             ${t.portals}
  chamadas HTTP       ${api.client.requestCount}

Scripts (advanced_condition de notificacao)
  ocorrencias         ${Object.keys(scriptIndex).length}
  unicos              ${pendingScripts.length}
  a explicar agora    ${fresh.length}

  ${relPath}
  ${pendingPath}
`);

  if (json._scope.catalogs_without_portal.length) {
    console.log('ATENCAO  catalogo(s) sem portal nenhum:');
    for (const c of json._scope.catalogs_without_portal) console.log(`  ${c.title} (${c.items} itens)`);
    console.log();
  }
  if (fresh.length) {
    console.log(`Fase 2: explique ${pendingPath} e rode merge-understandings.js\n`);
  }
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}\n`);
  process.exit(1);
});
