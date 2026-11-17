#!/usr/bin/env node
/**
 * Fase 2: injeta os `script_understanding` produzidos pelo LLM nos JSONs.
 *
 * Entradas (as mais recentes da pasta, resolvidas pelo carimbo no nome):
 *   catalog-map_<carimbo>.json           (fase 1)
 *   _scripts-pending_<carimbo>.json      (index ref -> hash da MESMA rodada)
 *   related-map_<carimbo>.json           (opcional)
 *   _related-scripts-pending_<carimbo>.json
 *   out/_scripts-understood.json         { "<hash>": "explicacao", ... }
 *   .cache/script-understandings.json    (acumulado de rodadas anteriores)
 *
 * Este e o unico script que ESCREVE POR CIMA de um arquivo de saida, e de
 * proposito: ele nao gera um levantamento novo, completa o que ja existe. Cada
 * lote preenche mais alguns slots do mesmo arquivo. Carimbar a cada lote daria
 * 20 copias de 23 MB da mesma rodada.
 *
 * O script cru nunca entra no arquivo final.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { newestRun, companionOf } from '../src/outFiles.js';

const outDir = resolve(process.cwd(), process.argv[2] ?? 'out');
const understoodPath = resolve(outDir, '_scripts-understood.json');
const cachePath = resolve(process.cwd(), '.cache/script-understandings.json');

const mapPath = newestRun(outDir, 'catalog-map');
if (!mapPath) {
  console.error(`Nao achei catalog-map em ${outDir} — rode scripts/extract.js primeiro.`);
  process.exit(1);
}
// O pending tem que ser o da MESMA rodada: o index ref -> hash e especifico
// daquele mapa. Cruzar rodadas preencheria script no registro errado, calado.
const pendingPath = companionOf(mapPath, outDir, '_scripts-pending');
if (!pendingPath) {
  console.error(`Achei ${mapPath} mas nao a fila de scripts da mesma rodada.`);
  process.exit(1);
}

const relPath = newestRun(outDir, 'related-map');
const relPendingPath = relPath ? companionOf(relPath, outDir, '_related-scripts-pending') : null;

const read = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

const json = read(mapPath);
const { index = {} } = read(pendingPath);
const understood = read(understoodPath);
const cache = read(cachePath);

// O que veio agora tem precedencia sobre o cache.
const byHash = { ...cache, ...understood };

let filled = 0;
const missing = [];

/** O slot de script e um objeto {script_understanding}; "" significa sem script. */
function fill(container, table, field = 'script', idx = index) {
  const slot = container?.[field];
  if (!slot || typeof slot !== 'object') return;
  const ref = `${table}:${container.sys_id}:${field}`;
  const text = byHash[idx[ref]];
  if (typeof text === 'string' && text.trim()) {
    slot.script_understanding = text.trim();
    filled++;
  } else {
    missing.push(ref);
  }
}

const PRODUCER_SCRIPTS = ['script', 'post_insert_script', 'save_script'];
const VARIABLE_SCRIPTS = ['read_script', 'post_insert_script', 'save_script'];
const POLICY_SCRIPTS = ['script_true', 'script_false'];

/** Scripts de variavel e de UI policy — o mesmo slot, em tabelas proprias. */
function fillVariablesAndPolicies(variables = [], policies = []) {
  for (const x of variables) for (const f of VARIABLE_SCRIPTS) fill(x, 'item_option_new', f);
  for (const p of policies) for (const f of POLICY_SCRIPTS) fill(p, 'catalog_ui_policy', f);
}

// O index dos relacionados e outro arquivo. Carregado aqui porque as colecoes
// deles podem estar DENTRO do catalog-map (depois do merge-related) ou fora,
// no related-map — e isto tem que funcionar nos dois casos.
const relIndex = read(relPendingPath).index ?? {};

for (const item of json.itens ?? []) {
  if (item.table_name !== undefined) {
    for (const field of PRODUCER_SCRIPTS) fill(item, 'sc_cat_item_producer', field);
  }
  for (const s of item.catalog_client_script ?? []) fill(s, 'catalog_script_client');
  fillVariablesAndPolicies(item.catalog_variables, item.catalog_ui_policies);
}
for (const set of json.variable_sets ?? []) {
  for (const s of set.vs_catalog_client_scripts ?? []) fill(s, 'catalog_script_client');
  fillVariablesAndPolicies(set.vs_variables, set.vs_ui_policies);
}
for (const uc of json.user_criteria ?? []) fill(uc, 'user_criteria');
// Arquivo unico (pos merge-related): as notificacoes moram aqui dentro.
for (const n of json.notifications ?? []) fill(n, 'sysevent_email_action', 'advanced_condition', relIndex);

writeFileSync(mapPath, JSON.stringify(json, null, 4), 'utf8');

// --- objetos relacionados, quando existirem em arquivo proprio -------------
let relFilled = 0;
if (relPath && relPendingPath) {
  const rel = read(relPath);
  const before = filled;
  for (const n of rel.notifications ?? []) fill(n, 'sysevent_email_action', 'advanced_condition', relIndex);
  relFilled = filled - before;
  writeFileSync(relPath, JSON.stringify(rel, null, 4), 'utf8');
}

mkdirSync(dirname(cachePath), { recursive: true });
writeFileSync(cachePath, JSON.stringify(byHash, null, 2), 'utf8');

// Progresso real: quantos dos scripts unicos da fila ja tem explicacao no cache.
const allScripts = [...(read(pendingPath).scripts ?? []), ...(read(relPendingPath).scripts ?? [])];
const explained = allScripts.filter((s) => byHash[s.hash]).length;
const left = allScripts.length - explained;

console.log(`\n${filled} slot(s) preenchido(s), ${missing.length} ainda sem explicacao`);
if (relFilled) console.log(`  (${relFilled} deles em ${relPath.split(/[\\/]/).pop()})`);
if (missing.length) {
  for (const ref of missing.slice(0, 5)) console.log(`  aguardando: ${ref}`);
  if (missing.length > 5) console.log(`  ... e mais ${missing.length - 5}`);
}
console.log(`\nFila de scripts: ${explained}/${allScripts.length} explicados`);
console.log(`cache: ${Object.keys(byHash).length} script(s) conhecido(s)`);
console.log(`\nAtualizados (mesma rodada, sem arquivo novo):`);
console.log(`  ${mapPath}`);
if (relFilled) console.log(`  ${relPath}`);
console.log(left > 0
  ? `\nAinda faltam ${left}. Proximo lote:\n  node scripts/next-batch.js --size 50\n`
  : `\nFila completa.\n`);
