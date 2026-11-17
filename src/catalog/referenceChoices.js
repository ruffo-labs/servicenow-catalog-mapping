import { rawValue as v } from '../tableApi.js';
import * as F from './fields.js';
import { shapeRecord, snValue } from './shape.js';
import { uniq, fetchByIds } from './collect.js';

/**
 * `reference_choices` — as opcoes de uma variavel que aponta para outra tabela,
 * resolvidas POR ITEM.
 *
 * Por que no item e nao no variable set: o set e compartilhado (o `RH Default`
 * entra em 108 itens) mas a lista de opcoes depende do item que o usa. A
 * variavel continua no set; as opcoes saem aqui, dentro do item.
 *
 * DE ONDE SAEM AS OPCOES — decidido por variavel, pelo `use_reference_qualifier`:
 *
 *   simple    o filtro esta em `reference_qual` (encoded query). Executa-se o filtro
 *             DECLARADO — `link: "reference_qual"`, certeza.
 *   demais    (advanced = script, dynamic, nenhum) o filtro nao e legivel sem executar
 *             script. Usa-se a regra do AMBIENTE (abaixo) — `link: "<campo>"`,
 *             candidato: e a regra aplicada ao item, nao o que o formulario mostra.
 *
 * REGRA POR AMBIENTE. A ligacao opcao -> item so e conhecida onde alguem a mapeou.
 * Na Assai QA a `service_offering` tem `u_catalog_items` (Glide List de
 * `sc_cat_item`). Instancia sem regra aqui sai exatamente como antes — sem a chave
 * `reference_choices` no item.
 *
 * Tudo GET. Ver DIRETRIZ #1.
 */
export const INSTANCE_RULES = {
  'assaiqa.service-now.com': [{
    referenceTable: 'service_offering',
    itemListField: 'u_catalog_items',
    fields: F.SERVICE_OFFERING_FIELDS,
    listFields: F.SERVICE_OFFERING_LIST_FIELDS,
    // O numero sozinho nao diz se a oferta esta ativa. Vistos na Assai QA:
    // 1 = Operacional, 2 = Nao operacional, 6 = Desativado. O label sai do registro.
    labels: ['operational_status', 'install_status'],
  }],
};

export function hostOf(api) {
  return new URL(api.client.config.instanceUrl).hostname.toLowerCase();
}

/** Regras da instancia conectada; vazio quando o ambiente nao tem regra. */
export function rulesFor(api) {
  return INSTANCE_RULES[hostOf(api)] ?? [];
}

/** Tabelas extras que o dicionario precisa ler quando ha regra. */
export function dictionaryTablesFor(api) {
  return Object.fromEntries(rulesFor(api).map((r) => [r.referenceTable, r.fields]));
}

/**
 * Le TODOS os registros da query por offset e confere com o X-Total-Count.
 *
 * Nao usa `api.queryAll` de proposito: a paginacao por keyset (`sys_id>cursor`)
 * devolve resultado ERRADO em silencio na `service_offering` — na Assai QA, um
 * filtro com 721 registros voltou 681 linhas e so 397 `sys_id` distintos. Um
 * item chega a ter 833 ofertas, entao passa de uma pagina. A `service_offering`
 * tambem nao pode ser contada pela Aggregate API (devolve 2 onde ha 7.133).
 * Se o total lido nao bater, estoura em vez de seguir com dado incompleto.
 */
async function fetchAllByOffset(api, table, query, fields) {
  const size = api.client.config.pageSize;
  const byId = new Map();
  let total = NaN;
  for (let offset = 0; ; offset += size) {
    const page = await api.query(table, { query: `${query}^ORDERBYsys_id`, fields, limit: size, offset });
    if (Number.isFinite(page.totalCount)) total = page.totalCount;
    for (const r of page.records) byId.set(v(r.sys_id), r);
    if (page.records.length < size) break;
  }
  if (Number.isFinite(total) && byId.size !== total) {
    throw new Error(`${table} [${query}]: li ${byId.size} registro(s) unicos, mas o X-Total-Count diz ${total}.`);
  }
  return [...byId.values()];
}

/** A variavel aponta para a tabela? Por `reference` ou por `lookup_table`. */
function pointsTo(variable, table) {
  return [v(variable.reference), v(variable.lookup_table)].includes(table);
}

/** Campos que dizem qual qualificador a variavel USA — nao entram no contrato das variaveis. */
const QUALIFIER_FIELDS = ['use_reference_qualifier', 'reference_qual', 'reference_qual_condition', 'dynamic_ref_qual'];

/** Encoded query declarada, sem o `^EQ` final que o condition builder acrescenta. */
const cleanQuery = (q) => String(q ?? '').trim().replace(/\^EQ$/i, '');

/**
 * Para cada variavel: de onde saem as opcoes de um item.
 * @returns {{link:string, mode:string, query:(itemId:string)=>string}}
 */
function sourceFor(rule, qualifier) {
  const mode = v(qualifier?.use_reference_qualifier) || 'none';
  const declared = cleanQuery(v(qualifier?.reference_qual_condition) || v(qualifier?.reference_qual));
  // `simple` com filtro legivel (sem script no meio): executa o filtro declarado.
  if (mode === 'simple' && declared && !/javascript:/i.test(declared)) {
    return { link: 'reference_qual', mode, query: () => declared };
  }
  return { link: rule.itemListField, mode, query: (itemId) => `${rule.itemListField}LIKE${itemId}` };
}

/**
 * Para cada item, as opcoes da tabela referenciada.
 *
 * @returns {Map<string, Array>} itemId -> [{ rule, link, mode, query, variables, options }]
 *   Um bloco por origem distinta de opcoes. So entram itens com ao menos uma
 *   variavel (propria ou de set) apontando para a tabela.
 */
export async function collectReferenceChoices(api, rules, { items, itemVariables, setVariables, setLinks }, log = () => {}) {
  const byItem = new Map();
  if (!rules.length) return byItem;

  const itemsOfSet = new Map();
  for (const l of setLinks) {
    const set = v(l.variable_set);
    if (!itemsOfSet.has(set)) itemsOfSet.set(set, []);
    itemsOfSet.get(set).push(v(l.sc_cat_item));
  }

  for (const rule of rules) {
    const pointing = [...itemVariables, ...setVariables].filter((r) => pointsTo(r, rule.referenceTable));
    // O qualificador em uso vem de campos que o contrato das variaveis nao carrega.
    const qualifiers = new Map(
      (await fetchByIds(api, 'item_option_new', pointing.map((r) => v(r.sys_id)), ['sys_id', ...QUALIFIER_FIELDS]))
        .map((r) => [v(r.sys_id), r]),
    );

    const varsByItem = new Map();
    const add = (itemId, record, setId) => {
      if (!varsByItem.has(itemId)) varsByItem.set(itemId, []);
      varsByItem.get(itemId).push({ record, setId, source: sourceFor(rule, qualifiers.get(v(record.sys_id))) });
    };
    for (const r of itemVariables) if (pointsTo(r, rule.referenceTable)) add(v(r.cat_item), r, '');
    for (const r of setVariables) {
      if (!pointsTo(r, rule.referenceTable)) continue;
      for (const itemId of uniq(itemsOfSet.get(v(r.variable_set)) ?? [])) add(itemId, r, v(r.variable_set));
    }

    // Filtro estatico se repete entre itens: le uma vez.
    const cache = new Map();
    const read = async (query) => {
      if (!cache.has(query)) cache.set(query, await fetchAllByOffset(api, rule.referenceTable, query, rule.fields));
      return cache.get(query);
    };

    let calls = 0;
    const porLink = {};
    for (const item of items) {
      const itemId = v(item.sys_id);
      const vars = varsByItem.get(itemId);
      if (!vars?.length) continue;

      // agrupa as variaveis do item por origem das opcoes
      const groups = new Map();
      for (const x of vars) {
        const query = x.source.query(itemId);
        if (!groups.has(query)) groups.set(query, { link: x.source.link, mode: x.source.mode, query, variables: [] });
        groups.get(query).variables.push({ record: x.record, setId: x.setId, mode: x.source.mode });
      }
      for (const g of groups.values()) {
        const options = await read(g.query);
        calls++;
        porLink[g.link] = (porLink[g.link] ?? 0) + 1;
        if (!byItem.has(itemId)) byItem.set(itemId, []);
        byItem.get(itemId).push({ rule, ...g, options });
      }
    }
    log(`reference_choices (${rule.referenceTable}): ${varsByItem.size} item(ns) com variavel; blocos por origem ${JSON.stringify(porLink)}`);
  }
  return byItem;
}

/** Forma do contrato. `setsById`: sys_id do set -> registro (para o titulo). */
export function buildReferenceChoices(entries, { dictionaries, setsById }) {
  return (entries ?? []).map(({ rule, link, mode, query, variables, options }) => ({
    reference_table: rule.referenceTable,
    // Grau de confianca, como no fulfillment:
    //   reference_qual -> o filtro DECLARADO na variavel foi executado (certeza)
    //   <campo>        -> regra do ambiente aplicada ao item (candidato); o
    //                     qualificador e script e nao foi lido (DIRETRIZ #3)
    link,
    qualifier_mode: mode,
    filter: query,
    variables: variables.map(({ record, setId }) => {
      const set = setId ? setsById.get(setId) : null;
      return {
        name: snValue(record.name),
        sys_id: v(record.sys_id),
        origin: setId ? 'variable_set' : 'item',
        variable_set: set
          ? { _display_value: snValue(set.title) || snValue(set.internal_name), __text: setId }
          : '',
        reference_qual: snValue(record.reference_qual),
      };
    }),
    total: options.length,
    options: options
      .map((o) => shapeRecord(o, rule.fields, {
        dictionary: dictionaries[rule.referenceTable] ?? {},
        listFields: rule.listFields,
        labels: rule.labels,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.number).localeCompare(String(b.number))),
  }));
}
