#!/usr/bin/env node
/**
 * Fase 2 em lotes retomaveis.
 *
 * 462 scripts unicos nao cabem numa passada so (~94k tokens de entrada). Este
 * script corta o proximo lote do que ainda nao foi explicado, olhando o cache
 * como fonte da verdade do progresso.
 *
 * Ciclo:
 *   node scripts/next-batch.js --size 50     -> escreve out/_scripts-batch.json
 *   (LLM le o lote e escreve out/_scripts-understood.json)
 *   node scripts/merge-understandings.js     -> injeta e grava no cache
 *   repete ate sobrar 0
 *
 * O cache torna o processo retomavel: se parar no meio, a proxima chamada
 * continua de onde estava.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const outDir = resolve(process.cwd(), flag('out', 'out'));
const size = Math.max(1, Number.parseInt(flag('size', '50'), 10) || 50);

const pendingPath = resolve(outDir, '_scripts-pending.json');
const batchPath = resolve(outDir, '_scripts-batch.json');
const understoodPath = resolve(outDir, '_scripts-understood.json');
const cachePath = resolve(process.cwd(), '.cache/script-understandings.json');

if (!existsSync(pendingPath)) {
  console.error(`Falta ${pendingPath} — rode scripts/extract.js primeiro.`);
  process.exit(1);
}

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const { scripts = [] } = read(pendingPath);
const cache = read(cachePath);

const remaining = scripts.filter((s) => !cache[s.hash]);
const done = scripts.length - remaining.length;

if (!remaining.length) {
  // Limpa o lote anterior para nao confundir a proxima rodada.
  if (existsSync(batchPath)) rmSync(batchPath);
  if (existsSync(understoodPath)) rmSync(understoodPath);
  console.log(`
Todos os ${scripts.length} script(s) ja foram explicados. Nada a fazer.
`);
  process.exit(0);
}

const batch = remaining.slice(0, size);
const bytes = batch.reduce((n, s) => n + s.script.length, 0);

writeFileSync(batchPath, JSON.stringify({
  batch_of: `${done + 1}-${done + batch.length} de ${scripts.length}`,
  instrucoes: 'Ver docs/script-understanding.md. Escrever out/_scripts-understood.json como { "<hash>": "explicacao" } apenas para os hashes deste lote.',
  scripts: batch,
}, null, 2), 'utf8');

// Zera o arquivo de respostas para o lote anterior nao ser recontado.
writeFileSync(understoodPath, '{}\n', 'utf8');

const barWidth = 30;
const filled = Math.round((done / scripts.length) * barWidth);
console.log(`
Progresso  [${'#'.repeat(filled)}${'.'.repeat(barWidth - filled)}]  ${done}/${scripts.length}

Lote atual      ${batch.length} script(s)  (~${Math.round(bytes / 4 / 1000)}k tokens de entrada)
Restam depois   ${remaining.length - batch.length}
Passadas ainda  ${Math.ceil(remaining.length / size)}

  ${batchPath}

Explique este lote, escreva out/_scripts-understood.json e rode:
  node scripts/merge-understandings.js
  node scripts/next-batch.js --size ${size}
`);
