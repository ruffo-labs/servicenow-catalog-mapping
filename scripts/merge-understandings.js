#!/usr/bin/env node
/**
 * Fase 2: injeta os `script_understanding` produzidos pelo LLM no JSON final.
 *
 * Entradas:
 *   out/catalog-map.json          (fase 1)
 *   out/_scripts-pending.json     (fase 1: traz o index ref -> hash)
 *   out/_scripts-understood.json  { "<hash>": "explicacao", ... }
 *   .cache/script-understandings.json  (acumulado de rodadas anteriores)
 *
 * Saida: sobrescreve out/catalog-map.json e atualiza o cache.
 * O script cru nunca entra no arquivo final.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const outDir = resolve(process.cwd(), process.argv[2] ?? 'out');
const mapPath = resolve(outDir, 'catalog-map.json');
const pendingPath = resolve(outDir, '_scripts-pending.json');
const understoodPath = resolve(outDir, '_scripts-understood.json');
const cachePath = resolve(process.cwd(), '.cache/script-understandings.json');

for (const p of [mapPath, pendingPath]) {
  if (!existsSync(p)) {
    console.error(`Falta ${p}: rode scripts/extract.js primeiro.`);
    process.exit(1);
  }
}

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

const json = read(mapPath);
const { index = {} } = read(pendingPath);
const understood = read(understoodPath);
const cache = read(cachePath);

// O que veio agora tem precedencia sobre o cache.
const byHash = { ...cache, ...understood };

let filled = 0;
const missing = [];

/** O slot de script e um objeto {script_understanding}; "" significa sem script. */
function fill(container, table, field = 'script') {
  const slot = container?.[field];
  if (!slot || typeof slot !== 'object') return;
  const ref = `${table}:${container.sys_id}:${field}`;
  const text = byHash[index[ref]];
  if (typeof text === 'string' && text.trim()) {
    slot.script_understanding = text.trim();
    filled++;
  } else {
    missing.push(ref);
  }
}

const PRODUCER_SCRIPTS = ['script', 'post_insert_script', 'save_script'];

for (const item of json.itens ?? []) {
  if (item.table_name !== undefined) {
    for (const field of PRODUCER_SCRIPTS) fill(item, 'sc_cat_item_producer', field);
  }
  for (const s of item.catalog_client_script ?? []) fill(s, 'catalog_script_client');
}
for (const set of json.variable_sets ?? []) {
  for (const s of set.vs_catalog_client_scripts ?? []) fill(s, 'catalog_script_client');
}
for (const uc of json.user_criteria ?? []) fill(uc, 'user_criteria');

writeFileSync(mapPath, JSON.stringify(json, null, 4), 'utf8');

mkdirSync(dirname(cachePath), { recursive: true });
writeFileSync(cachePath, JSON.stringify(byHash, null, 2), 'utf8');

// Progresso real: quantos dos scripts unicos da fila ja tem explicacao no cache.
const pending = read(pendingPath);
const allScripts = pending.scripts ?? [];
const explained = allScripts.filter((s) => byHash[s.hash]).length;
const left = allScripts.length - explained;

console.log(`\n${filled} slot(s) preenchido(s) no JSON, ${missing.length} ainda sem explicacao`);
if (missing.length) {
  for (const ref of missing.slice(0, 5)) console.log(`  aguardando: ${ref}`);
  if (missing.length > 5) console.log(`  ... e mais ${missing.length - 5}`);
}
console.log(`\nFila de scripts: ${explained}/${allScripts.length} explicados`);
console.log(`cache: ${Object.keys(byHash).length} script(s) conhecido(s)`);
console.log(`${mapPath}`);
console.log(left > 0
  ? `\nAinda faltam ${left}. Proximo lote:\n  node scripts/next-batch.js --size 50\n`
  : `\nFila completa.\n`);
