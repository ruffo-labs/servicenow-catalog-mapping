import { LIST_FIELDS } from './fields.js';

/**
 * Converte o formato da Table API (`sysparm_display_value=all`, que devolve
 * {value, display_value} por campo) para o formato do contrato de saída.
 * Ver docs/output-schema.md.
 */

/** Escalar -> string. Booleano e número também saem como string, como no export XML. */
export function snValue(field) {
  if (field == null) return '';
  if (typeof field === 'object') return field.value ?? '';
  return String(field);
}

/** Label de um campo de choice (ex.: type "6" -> "Single Line Text"). */
export function snLabel(field) {
  if (field == null) return '';
  if (typeof field === 'object') return field.display_value ?? '';
  return '';
}

/** Referência -> "" quando vazia, senão {_display_value, __text}. */
export function snRef(field) {
  const value = snValue(field);
  if (!value) return '';
  return { _display_value: snLabel(field), __text: value };
}

/**
 * Glide List (multi-valor).
 *   vazio      -> ""
 *   1 valor    -> {_display_value, __text}
 *   N valores  -> "Nome A, Nome B"   (só os nomes, por decisão do contrato)
 */
export function snList(field) {
  const value = snValue(field);
  if (!value) return '';
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length <= 1) return { _display_value: snLabel(field), __text: ids[0] ?? value };
  const labels = snLabel(field);
  return labels || ids.join(', ');
}

/**
 * Aplica snRef/snList/snValue conforme o tipo do campo no dicionário.
 *
 * `listFields` troca o conjunto de Glide Lists por tabela. O padrao e o global
 * `LIST_FIELDS`, que serve ao catalogo; as tabelas relacionadas tem outro
 * conjunto -- `sys_report.user`, por exemplo, e string com sys_id dentro, nao
 * Glide List, e trata-lo como lista produziria uma referencia falsa.
 */
export function shapeRecord(record, fields, { dictionary = {}, labels = [], listFields = LIST_FIELDS } = {}) {
  const wantsLabel = new Set(labels);
  const out = {};
  for (const name of fields) {
    const raw = record[name];
    if (listFields.has(name)) out[name] = snList(raw);
    else if (dictionary[name]?.isReference) out[name] = snRef(raw);
    else out[name] = snValue(raw);
    // o label entra logo depois do campo, nao no fim do objeto
    if (wantsLabel.has(name)) out[`${name}_label`] = snLabel(raw);
  }
  return out;
}

/**
 * Script -> "" quando vazio, senão {script_understanding: null}.
 * O texto é preenchido na fase de enriquecimento por LLM; o script cru NÃO
 * entra no JSON final (decisão do contrato — é levantamento, não backup).
 */
export function scriptSlot(rawScript, { withSource = false } = {}) {
  if (!rawScript) return '';
  // `source` so entra quando quem executa pede (--with-source): levantamento para migracao.
  return withSource ? { script_understanding: null, source: rawScript } : { script_understanding: null };
}

/**
 * Script sem codigo: so comentario, ou o stub `function onCondition() {}` que o
 * ServiceNow grava em toda UI policy, ou o comentario-modelo do `save_script`.
 * Medido num levantamento real: mais de 90% das ocorrencias de script eram isso.
 */
export function isBlankScript(raw) {
  const code = String(raw ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/function\s+onCondition\s*\(\s*\)\s*\{\s*\}/g, '');
  return code.trim() === '';
}

/**
 * Troca `IO:<sys_id>` pelo nome da variável numa encoded query de condição.
 * O que não for resolvido fica como está, para não mascarar buraco no mapa.
 */
export function labelConditions(conditions, variableNameById) {
  if (!conditions) return '';
  return conditions.replace(/IO:([0-9a-f]{32})/gi, (match, sysId) => {
    const name = variableNameById.get(sysId.toLowerCase());
    return name ? `IO:${name}` : match;
  });
}
