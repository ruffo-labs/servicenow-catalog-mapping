#!/usr/bin/env node
/**
 * Junta o `related-map` dentro do `catalog-map`, para quem prefere um arquivo
 * so. Nao consulta a instancia — trabalha com o que ja esta em disco.
 *
 * **Nao sobrescreve nada.** Le os dois mais recentes e grava um TERCEIRO
 * arquivo, com carimbo proprio:
 *
 *   catalog-map_2026-09-23_14-57-21.json          (entrada, intacta)
 *   related-map_2026-09-23_15-10-02.json          (entrada, intacta)
 *   catalog-map-completo_2026-09-23_15-12-40.json (saida)
 *
 * Por isso nao existe mais copia de seguranca nem `--undo`: o original
 * continua la, e comparar e so abrir os dois.
 *
 * Uso:
 *   node scripts/merge-related.js out/consolidado
 *   node scripts/merge-related.js out/consolidado --map <arq> --related <arq>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { timestamp, stampedPath, newestRun, mb } from '../src/outFiles.js';

const argv = process.argv.slice(2);
const flags = {};
const soltos = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) { soltos.push(argv[i]); continue; }
  const chave = argv[i].slice(2);
  const proximo = argv[i + 1];
  if (proximo === undefined || proximo.startsWith('--')) flags[chave] = true;
  else { flags[chave] = proximo; i++; }
}

const dir = resolve(process.cwd(), soltos[0] ?? 'out');
const escolhe = (nome, base) => (typeof flags[nome] === 'string'
  ? resolve(process.cwd(), flags[nome])
  : newestRun(dir, base));

const mapPath = escolhe('map', 'catalog-map');
const relPath = escolhe('related', 'related-map');

for (const [p, oque] of [[mapPath, 'catalog-map'], [relPath, 'related-map']]) {
  if (!p || !existsSync(p)) {
    console.error(`\nNao achei ${oque} em ${dir}. Rode extract.js e extract-related.js primeiro.\n`);
    process.exit(1);
  }
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const rel = JSON.parse(readFileSync(relPath, 'utf8'));

// Conferencia: o related tem que ter sido gerado a partir DESTE mapeamento.
// Juntar rodadas diferentes produziria um arquivo plausivel e errado.
const doMapa = new Set((map.itens ?? []).map((i) => i.sys_id));
const forasteiros = (rel._scope?.case_tables ?? [])
  .flatMap((t) => t.item_sys_ids ?? [])
  .filter((id) => !doMapa.has(id));
if (forasteiros.length) {
  console.error(`
Os dois arquivos sao de recortes diferentes: ${forasteiros.length} item(ns) do
escopo do related nao estao neste catalog-map.

  ${mapPath}
  ${relPath}

Rode o extract-related apontando para este mapa, ou passe --map/--related.
`);
  process.exit(1);
}

// A ordem importa para leitura humana: o que ja existia primeiro.
const merged = {
  itens: map.itens ?? [],
  variable_sets: map.variable_sets ?? [],
  user_criteria: map.user_criteria ?? [],
  related_scope: rel._scope ?? {},
  notifications: rel.notifications ?? [],
  slas: rel.slas ?? [],
  reports: rel.reports ?? [],
  portals: rel.portals ?? [],
};
// Qualquer chave que eu nao conheca continua indo junto.
for (const [k, v] of Object.entries(map)) if (!(k in merged)) merged[k] = v;

const stamp = timestamp();
const saida = stampedPath(dir, 'catalog-map-completo', stamp);
writeFileSync(saida, JSON.stringify(merged, null, 4), 'utf8');

const t = merged.related_scope.totals ?? {};
console.log(`
Merge feito — nenhuma entrada foi alterada

  entrada   ${mapPath}
            ${mb(mapPath)} MB
  entrada   ${relPath}
            ${mb(relPath)} MB

  SAIDA     ${saida}
            ${mb(saida)} MB

  itens            ${merged.itens.length}
  variable_sets    ${merged.variable_sets.length}
  user_criteria    ${merged.user_criteria.length}
  notifications    ${merged.notifications.length}   (${t.notifications_active ?? '?'} ativas)
  slas             ${merged.slas.length}   (${merged.slas.filter((s) => s.type === 'SLA').length} SLA + ${merged.slas.filter((s) => s.type === 'OLA').length} OLA + ${merged.slas.filter((s) => s.type !== 'SLA' && s.type !== 'OLA').length} outro tipo)
  reports          ${merged.reports.length}
  portals          ${merged.portals.length}
`);
