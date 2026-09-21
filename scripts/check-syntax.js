#!/usr/bin/env node
/**
 * Checagem de sintaxe de todo o codigo. E o substituto do typecheck enquanto o
 * projeto nao adota TypeScript (ver DEBT.md).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const IGNORAR = new Set(['node_modules', '.git', 'out', '.cache', '.claude']);

function listar(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...listar(caminho));
    else if (nome.endsWith('.js')) achados.push(caminho);
  }
  return achados;
}

const arquivos = listar(root);
let falhas = 0;

for (const arquivo of arquivos) {
  try {
    execFileSync(process.execPath, ['--check', arquivo], { stdio: 'pipe' });
  } catch (err) {
    falhas++;
    console.error(`\n${relative(root, arquivo)}`);
    console.error(String(err.stderr).trim());
  }
}

if (falhas) {
  console.error(`\nsintaxe: ${falhas} arquivo(s) com erro\n`);
  process.exit(1);
}
console.log(`sintaxe: ok (${arquivos.length} arquivo(s))`);
