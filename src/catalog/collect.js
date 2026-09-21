import { TableApi, rawValue } from '../tableApi.js';
import * as F from './fields.js';

const CHUNK = 50;

const chunks = (arr, n = CHUNK) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/** Hierarquia de tabelas (sc_cat_item -> sys_metadata -> ...), para ler o dicionario completo. */
export async function tableHierarchy(api, table) {
  const chain = [];
  let current = table;
  while (current && !chain.includes(current) && chain.length < 10) {
    chain.push(current);
    const row = await api.query('sys_db_object', {
      query: `name=${current}`, fields: ['super_class'], limit: 1, displayValue: 'all',
    });
    const superRef = row.records[0]?.super_class;
    if (!rawValue(superRef)) break;
    const parent = await api.getRecord('sys_db_object', rawValue(superRef), { fields: ['name'] });
    current = rawValue(parent?.name);
  }
  return chain;
}

/**
 * Dicionario de uma tabela (incluindo herdados) + aviso sobre campos pedidos
 * que nao existem nesta instancia.
 */
export async function describeTable(api, table, wantedFields = []) {
  const chain = await tableHierarchy(api, table);
  const rows = await api.queryAll('sys_dictionary', {
    query: `nameIN${chain.join(',')}^elementISNOTEMPTY`,
    fields: ['element', 'internal_type', 'reference'],
    displayValue: 'false',
  });
  const dictionary = {};
  for (const r of rows) {
    const type = rawValue(r.internal_type);
    dictionary[rawValue(r.element)] = {
      type,
      isReference: type === 'reference' || type === 'document_id',
      reference: rawValue(r.reference),
    };
  }
  const known = new Set(['sys_id', 'sys_class_name']);
  const missing = wantedFields.filter((f) => !dictionary[f] && !known.has(f));
  return { dictionary, missing, chain };
}

/** Busca em lote por um campo pai: `<field>IN<id1>,<id2>,...`. */
async function fetchByParent(api, table, field, ids, fields, { orderBy } = {}) {
  if (!ids.length) return [];
  // Tamanho do lote calculado pelo limite de URL, nao fixo: ver maxIdsPerQuery.
  const size = api.maxIdsPerQuery(table, {
    fields,
    queryOverhead: field.length + 2 + (orderBy ? orderBy.length + 10 : 0),
  });
  const out = [];
  for (const batch of chunks(uniq(ids), size)) {
    let query = `${field}IN${batch.join(',')}`;
    if (orderBy) query += `^ORDERBY${orderBy}`;
    out.push(...(await api.queryAll(table, { query, fields })));
  }
  return out;
}

const fetchByIds = (api, table, ids, fields) => fetchByParent(api, table, 'sys_id', ids, fields);

/** Agrupa registros por um campo de referencia. */
function groupBy(records, field) {
  const map = new Map();
  for (const r of records) {
    const key = rawValue(r[field]);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

/**
 * Monta a encoded query dos itens a partir do filtro pedido a quem executa.
 * @param {object} filter
 * @param {boolean} [filter.activeOnly]
 * @param {'item'|'producer'|'all'} [filter.kind]
 * @param {string} [filter.catalog]   sys_id
 * @param {string} [filter.category]  sys_id
 * @param {string} [filter.name]      substring
 * @param {string[]} [filter.sysIds]
 * @param {string} [filter.updatedAfter]  formato "YYYY-MM-DD HH:mm:ss" em GMT
 * @param {string} [filter.rawQuery]  encoded query extra
 */
export function buildItemQuery(filter = {}) {
  // Query crua tem precedencia e vai literal: e como o usuario normalmente opera.
  if (filter.rawQuery) return filter.rawQuery;

  const parts = [];
  if (filter.activeOnly !== false) parts.push('active=true');
  if (filter.kind === 'producer') parts.push('sys_class_name=sc_cat_item_producer');
  else if (filter.kind === 'item') parts.push('sys_class_name=sc_cat_item');
  if (filter.catalog) parts.push(`sc_catalogsLIKE${filter.catalog}`);
  if (filter.category) parts.push(`category=${filter.category}`);
  if (filter.name) parts.push(`nameLIKE${filter.name}`);
  if (filter.sysIds?.length) parts.push(`sys_idIN${filter.sysIds.join(',')}`);
  if (filter.updatedAfter) parts.push(`sys_updated_on>=${filter.updatedAfter}`);
  return parts.join('^');
}

const PRODUCER_CLASS = 'sc_cat_item_producer';

/**
 * Passo obrigatorio antes de qualquer mapeamento: le apenas o minimo da
 * sc_cat_item (que ja traz itens de catalogo E record producers) e devolve
 * quantos sao, quais sao e de que tipo cada um e: para o usuario confirmar.
 *
 * Nunca roda sem query: ler o catalogo inteiro nao e permitido.
 */
export async function preview(api, query) {
  if (!query || !query.trim()) {
    throw new Error('Query obrigatoria. Nao e permitido ler a sc_cat_item inteira sem filtro.');
  }
  const records = await api.queryAll('sc_cat_item', {
    query, fields: ['sys_id', 'name', 'sys_class_name', 'active'],
  });

  // table_name so existe na classe filha: vale a chamada extra: e por ela que
  // se confere se o conjunto bate com o esperado quando sao muitos itens.
  const producerIds = records
    .filter((r) => rawValue(r.sys_class_name) === PRODUCER_CLASS)
    .map((r) => rawValue(r.sys_id));
  const tableById = new Map();
  for (let i = 0; i < producerIds.length; i += 50) {
    const batch = producerIds.slice(i, i + 50);
    for (const p of await api.queryAll(PRODUCER_CLASS, {
      query: `sys_idIN${batch.join(',')}`, fields: ['sys_id', 'table_name'], displayValue: 'false',
    })) tableById.set(rawValue(p.sys_id), rawValue(p.table_name));
  }

  const rows = records.map((r) => ({
    sys_id: rawValue(r.sys_id),
    name: rawValue(r.name),
    sys_class_name: rawValue(r.sys_class_name),
    active: rawValue(r.active),
    table_name: tableById.get(rawValue(r.sys_id)) ?? '',
    kind: rawValue(r.sys_class_name) === PRODUCER_CLASS ? 'Record Producer' : 'Catalog Item',
  })).sort((a, b) => a.kind.localeCompare(b.kind)
    || a.table_name.localeCompare(b.table_name)
    || a.name.localeCompare(b.name));

  return {
    query,
    rows,
    total: rows.length,
    producers: rows.filter((r) => r.kind === 'Record Producer').length,
    items: rows.filter((r) => r.kind === 'Catalog Item').length,
  };
}

/**
 * Coleta tudo que o contrato precisa, em lote (uma chamada por tabela por lote
 * de 50 sys_ids, nao uma por item).
 */
export async function collect(api = new TableApi(), filter = {}, log = () => {}, { runtimeSample = 0 } = {}) {
  const itemQuery = buildItemQuery(filter);
  if (!itemQuery.trim()) {
    throw new Error('Query obrigatoria. Nao e permitido ler a sc_cat_item inteira sem filtro.');
  }
  log(`query dos itens: ${itemQuery}`);

  // A sc_cat_item traz item de catalogo E record producer: e por ela que se descobre quem e quem.
  const discovered = await api.queryAll('sc_cat_item', { query: itemQuery, fields: F.ITEM_FIELDS });
  const itemIds = discovered.map((r) => rawValue(r.sys_id));
  if (!discovered.length) return emptyResult(itemQuery);

  // Record producer e relido na classe filha, que ja traz base + campos proprios.
  const producerIds = discovered
    .filter((r) => rawValue(r.sys_class_name) === PRODUCER_CLASS)
    .map((r) => rawValue(r.sys_id));
  const producers = await fetchByIds(api, PRODUCER_CLASS, producerIds, [...F.ITEM_FIELDS, ...F.PRODUCER_FIELDS]);
  const producerById = new Map(producers.map((r) => [rawValue(r.sys_id), r]));

  // Catalog item fica com o registro da sc_cat_item; producer com o da classe filha.
  const items = discovered.map((r) => producerById.get(rawValue(r.sys_id)) ?? r);
  log(`itens: ${items.length} (${producers.length} record producer, ${items.length - producers.length} catalog item)`);

  const itemVariables = await fetchByParent(api, 'item_option_new', 'cat_item', itemIds, F.VARIABLE_FIELDS, { orderBy: 'order' });

  const setLinks = await fetchByParent(api, 'io_set_item', 'sc_cat_item', itemIds, F.SET_LINK_FIELDS);
  const setIds = uniq(setLinks.map((r) => rawValue(r.variable_set)));
  const sets = await fetchByIds(api, 'item_option_new_set', setIds, F.SET_FIELDS);
  log(`variable sets em uso: ${sets.length}`);

  const setVariables = await fetchByParent(api, 'item_option_new', 'variable_set', setIds, F.VARIABLE_FIELDS, { orderBy: 'order' });

  // Regra do contrato: se existe choice cadastrada, mapeia -- independente do type.
  const allVariables = [...itemVariables, ...setVariables];
  const choices = await fetchByParent(
    api, 'question_choice', 'question', allVariables.map((r) => rawValue(r.sys_id)),
    F.CHOICE_FIELDS, { orderBy: 'order' },
  );
  log(`variaveis: ${allVariables.length} (${choices.length} choices)`);

  const itemPolicies = await fetchByParent(api, 'catalog_ui_policy', 'catalog_item', itemIds, F.UI_POLICY_FIELDS);
  const setPolicies = await fetchByParent(api, 'catalog_ui_policy', 'variable_set', setIds, F.UI_POLICY_FIELDS);
  const policyActions = await fetchByParent(
    api, 'catalog_ui_policy_action', 'ui_policy',
    [...itemPolicies, ...setPolicies].map((r) => rawValue(r.sys_id)),
    F.UI_POLICY_ACTION_FIELDS, { orderBy: 'order' },
  );

  const itemScripts = await fetchByParent(api, 'catalog_script_client', 'cat_item', itemIds, F.CLIENT_SCRIPT_FIELDS);
  const setScripts = await fetchByParent(api, 'catalog_script_client', 'variable_set', setIds, F.CLIENT_SCRIPT_FIELDS);

  const availableLinks = await fetchByParent(api, 'sc_cat_item_user_criteria_mtom', 'sc_cat_item', itemIds, F.UC_LINK_FIELDS);
  const notAvailableLinks = await fetchByParent(api, 'sc_cat_item_user_criteria_no_mtom', 'sc_cat_item', itemIds, F.UC_LINK_FIELDS);
  const criteriaIds = uniq([...availableLinks, ...notAvailableLinks].map((r) => rawValue(r.user_criteria)));
  const userCriteria = await fetchByIds(api, 'user_criteria', criteriaIds, F.USER_CRITERIA_FIELDS);
  log(`user criteria em uso: ${userCriteria.length}`);

  const { collectFulfillment } = await import('./fulfillment.js');
  const fulfillmentByItem = await collectFulfillment(api, items, { runtimeSample }, log);

  return {
    fulfillmentByItem,
    itemQuery,
    items,
    producerIds: new Set(producerIds),
    variablesByItem: groupBy(itemVariables, 'cat_item'),
    variablesBySet: groupBy(setVariables, 'variable_set'),
    choicesByVariable: groupBy(choices, 'question'),
    setLinksByItem: groupBy(setLinks, 'sc_cat_item'),
    sets,
    policiesByItem: groupBy(itemPolicies, 'catalog_item'),
    policiesBySet: groupBy(setPolicies, 'variable_set'),
    actionsByPolicy: groupBy(policyActions, 'ui_policy'),
    scriptsByItem: groupBy(itemScripts, 'cat_item'),
    scriptsBySet: groupBy(setScripts, 'variable_set'),
    availableByItem: groupBy(availableLinks, 'sc_cat_item'),
    notAvailableByItem: groupBy(notAvailableLinks, 'sc_cat_item'),
    userCriteria,
    allVariables,
  };
}

function emptyResult(itemQuery) {
  return {
    itemQuery, items: [], producerIds: new Set(), fulfillmentByItem: new Map(), variablesByItem: new Map(),
    variablesBySet: new Map(), choicesByVariable: new Map(), setLinksByItem: new Map(),
    sets: [], policiesByItem: new Map(), policiesBySet: new Map(), actionsByPolicy: new Map(),
    scriptsByItem: new Map(), scriptsBySet: new Map(), availableByItem: new Map(),
    notAvailableByItem: new Map(), userCriteria: [], allVariables: [],
  };
}

export { fetchByParent, fetchByIds, uniq };
