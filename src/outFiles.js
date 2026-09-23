import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Nomes de arquivo de saida com carimbo de data/hora, para nunca sobrescrever
 * um levantamento anterior.
 *
 *   catalog-map_2026-09-23_14-57-21.json
 *
 * Por que nao `HH:MM:SS` como no pedido: **dois-pontos e caractere proibido em
 * nome de arquivo no Windows** (e atrapalha em `scp`/URL no resto). O `-` no
 * lugar mantem a mesma informacao, ordena igual e nao exige aspas no shell.
 *
 * O formato e lexicograficamente ordenavel de proposito: o mais recente e o
 * ultimo na ordem alfabetica, entao achar a rodada mais nova nao depende de
 * mtime (que muda quando alguem copia arquivo).
 *
 * A hora e a LOCAL da maquina que rodou — e carimbo para humano se achar. As
 * datas DENTRO do JSON (`measured_at`, `generated_at`) continuam em UTC.
 */

const RE_STAMP = /_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?=\.[^.]+$)/;

/** '2026-09-23_14-57-21' */
export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** catalog-map + stamp + .json -> 'catalog-map_2026-09-23_14-57-21.json' */
export function stampedName(base, stamp, ext = '.json') {
  return `${base}_${stamp}${ext}`;
}

export function stampedPath(dir, base, stamp, ext = '.json') {
  return resolve(dir, stampedName(base, stamp, ext));
}

/** Extrai o carimbo de um caminho, ou null se o arquivo nao tiver. */
export function stampOf(file) {
  return file.match(RE_STAMP)?.[1] ?? null;
}

/**
 * Todas as rodadas de um artefato, da mais antiga para a mais recente.
 * Inclui o nome antigo sem carimbo (`catalog-map.json`), quando existir, como
 * a rodada mais antiga — levantamentos feitos antes desta mudanca continuam
 * funcionando.
 */
export function listRuns(dir, base, ext = '.json') {
  if (!existsSync(dir)) return [];
  const comCarimbo = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}_`) && f.endsWith(ext) && RE_STAMP.test(f))
    .sort()
    .map((f) => resolve(dir, f));
  const legado = resolve(dir, `${base}${ext}`);
  return existsSync(legado) ? [legado, ...comCarimbo] : comCarimbo;
}

/** O artefato mais recente, ou null. */
export function newestRun(dir, base, ext = '.json') {
  return listRuns(dir, base, ext).at(-1) ?? null;
}

/**
 * O par de arquivos da MESMA rodada. O `_scripts-pending` carrega o index
 * ref -> hash daquele `catalog-map` especifico: cruzar rodadas diferentes
 * preencheria script no registro errado, em silencio.
 */
export function companionOf(file, dir, base, ext = '.json') {
  const stamp = stampOf(file);
  if (!stamp) {
    const legado = resolve(dir, `${base}${ext}`);
    return existsSync(legado) ? legado : null;
  }
  const alvo = stampedPath(dir, base, stamp, ext);
  return existsSync(alvo) ? alvo : null;
}

/** Para log: '(3 rodada(s) anteriores nesta pasta)'. */
export function resumoDeRodadas(dir, base, ext = '.json') {
  const n = listRuns(dir, base, ext).length;
  return n ? `${n} rodada(s) ja nesta pasta` : 'primeira rodada nesta pasta';
}

/** MB com uma casa, para os relatorios. */
export function mb(file) {
  return (statSync(file).size / 1024 / 1024).toFixed(1);
}
