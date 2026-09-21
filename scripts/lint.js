#!/usr/bin/env node
/**
 * Lint de dominio. Aplica as regras que uma maquina consegue verificar, para
 * elas nao dependerem de memoria (ver HARNESS, principio central).
 *
 * Regras:
 *   1. Travessao (em dash) proibido em qualquer texto.
 *   2. Nenhum metodo HTTP de escrita declarado fora do fluxo OAuth (DIRETRIZ #1).
 *   3. Nada de marcador de pendencia solto no codigo: divida vai para DEBT.md.
 *
 * Uso: node scripts/lint.js [--docs]
 *   --docs  inclui os arquivos .md na verificacao
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const incluirDocs = process.argv.includes('--docs');

const EM_DASH = String.fromCharCode(0x2014);
const MARCADOR_PENDENTE = new RegExp('\\b(' + ['TO', 'DO'].join('') + '|' + ['FIX', 'ME'].join('') + ')\\b');

const PASTAS_IGNORADAS = new Set(['node_modules', '.git', 'out', '.cache', '.claude']);

function listar(dir, aceita) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    if (PASTAS_IGNORADAS.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...listar(caminho, aceita));
    else if (aceita(nome)) achados.push(caminho);
  }
  return achados;
}

const problemas = [];

function reportar(arquivo, linha, regra, texto) {
  problemas.push({ arquivo: relative(root, arquivo), linha, regra, texto });
}

// Regra 1: travessao
const alvos = listar(root, (n) => n.endsWith('.js') || (incluirDocs && n.endsWith('.md')));
for (const arquivo of alvos) {
  const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/);
  linhas.forEach((linha, i) => {
    if (linha.includes(EM_DASH)) {
      reportar(arquivo, i + 1, 'travessao', linha.trim().slice(0, 70));
    }
  });
}

// Regra 2: metodo de escrita no cliente HTTP
const clientePath = join(root, 'src', 'snClient.js');
const cliente = readFileSync(clientePath, 'utf8');
const semOAuth = cliente.replace(/const res = await fetch\(`\$\{instanceUrl\}\/oauth_token\.do`[\s\S]*?\}\);/, '');
for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const re = new RegExp(`method:\\s*['"\`]${metodo}`, 'i');
  if (re.test(semOAuth)) {
    reportar(clientePath, 0, 'metodo-de-escrita', `method: '${metodo}' fora do fluxo OAuth`);
  }
}

// Regra 3: marcador de pendencia solto
for (const arquivo of listar(root, (n) => n.endsWith('.js'))) {
  const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/);
  linhas.forEach((linha, i) => {
    if (MARCADOR_PENDENTE.test(linha)) {
      reportar(arquivo, i + 1, 'pendencia-solta', linha.trim().slice(0, 70));
    }
  });
}

if (problemas.length === 0) {
  console.log(`lint: ok (${alvos.length} arquivo(s) verificado(s)${incluirDocs ? ', docs incluidos' : ''})`);
  process.exit(0);
}

const porRegra = {};
for (const p of problemas) (porRegra[p.regra] ??= []).push(p);

console.error(`\nlint: ${problemas.length} problema(s)\n`);
for (const [regra, lista] of Object.entries(porRegra)) {
  console.error(`  [${regra}] ${lista.length}`);
  for (const p of lista.slice(0, 15)) {
    console.error(`    ${p.arquivo}:${p.linha}  ${p.texto}`);
  }
  if (lista.length > 15) console.error(`    ... e mais ${lista.length - 15}`);
  console.error('');
}
console.error('Travessao: troque por dois pontos, virgula ou parenteses.');
console.error('Pendencia solta: registre em DEBT.md com data, motivo e plano.\n');
process.exit(1);
