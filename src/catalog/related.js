import { createHash } from 'node:crypto';
import { rawValue as v, displayValue as d } from '../tableApi.js';
import * as F from './fields.js';
import { shapeRecord, snValue, scriptSlot } from './shape.js';
import { fetchByParent, fetchByIds, uniq } from './collect.js';

/**
 * Objetos que pertencem as TABELAS DESTINO dos itens mapeados, nao ao item:
 * notificacoes, SLA/OLA, reports e portais.
 *
 * Saem em colecoes proprias no topo do JSON — como `variable_sets` — porque um
 * mesmo SLA vale para todos os itens que caem na mesma tabela; repetir dentro
 * de cada item seria duplicar a mesma informacao 148 vezes.
 *
 * Tudo GET. Ver DIRETRIZ #1.
 */

export const RELATED_TABLES = {
  sysevent_email_action: F.NOTIFICATION_FIELDS,
  contract_sla: F.SLA_FIELDS,
  sys_report: F.REPORT_FIELDS,
  sys_report_users_groups: F.REPORT_SHARE_FIELDS,
  sp_portal: F.PORTAL_FIELDS,
  m2m_sp_portal_catalog: F.PORTAL_CATALOG_FIELDS,
};

/** Tabela do chamado gerado por catalog item comum (decisao do usuario: sempre esta). */
export const CATALOG_ITEM_TABLE = 'sc_req_item';

/** Campo que liga cada tabela a uma tabela de negocio — lido do dicionario, nao chutado. */
const LINK_FIELD = {
  sysevent_email_action: 'collection',
  contract_sla: 'collection',
  sys_report: 'table',
};

/**
 * Descobre o recorte a partir do catalog-map.json ja pronto.
 *
 * As tabelas destino vem dos record producers mapeados. Mas o SLA mede o caso e
 * o OLA mede a TAREFA: na Natura QA as 5 tabelas de caso tem 440 SLA e ZERO
 * OLA — os 398 OLA estao nas tabelas de tarefa do mesmo app. Por isso o recorte
 * sobe para "tudo que estende `task` nos mesmos `sys_scope`", resolvido pela
 * heranca — nao por prefixo de nome, que seria chute.
 */
export async function discoverScope(api, map, log = () => {}) {
  const itemsByTable = new Map();
  for (const it of map.itens ?? []) {
    // Catalog item comum (sem table_name) gera RITM: a tabela e sempre sc_req_item.
    const t = typeof it.table_name === 'string' && it.table_name ? it.table_name : CATALOG_ITEM_TABLE;
    if (!itemsByTable.has(t)) itemsByTable.set(t, []);
    itemsByTable.get(t).push({ sys_id: it.sys_id, name: it.name });
  }
  const caseTables = [...itemsByTable.keys()].sort();
  if (!caseTables.length) throw new Error('O catalog-map.json informado nao tem itens.');
  log(`tabelas de caso vindas do mapeamento: ${caseTables.length}`);

  // A expansao para tabelas de tarefa so vale para tabelas destino de record
  // producer (app proprio). `sc_req_item` e do catalogo inteiro: expandir pelo
  // escopo dela traria as tarefas de toda a plataforma.
  const scopeTables = caseTables.filter((t) => t !== CATALOG_ITEM_TABLE);
  const scopes = new Map();
  for (const t of scopeTables) {
    const { records } = await api.query('sys_db_object', { query: `name=${t}`, fields: ['sys_scope'], limit: 1 });
    const id = v(records[0]?.sys_scope);
    if (id) scopes.set(id, d(records[0]?.sys_scope) || id);
  }
  log(scopes.size ? `escopos de aplicacao: ${[...scopes.values()].join(', ')}` : 'sem escopo a expandir (so sc_req_item)');

  // Todas as tabelas desses escopos; a heranca e resolvida em memoria para nao
  // pagar uma ida por tabela.
  const rows = scopes.size
    ? await api.queryAll('sys_db_object', {
      query: `sys_scopeIN${[...scopes.keys()].join(',')}`,
      fields: ['sys_id', 'name', 'label', 'super_class', 'sys_scope'],
    })
    : [];
  const byName = new Map(rows.map((r) => [v(r.name), r]));
  const parentName = new Map();
  for (const p of await fetchByIds(api, 'sys_db_object', uniq(rows.map((r) => v(r.super_class))), ['sys_id', 'name'])) {
    parentName.set(v(p.sys_id), v(p.name));
  }

  const chainOf = (row) => {
    const chain = [];
    let cur = v(row.super_class);
    while (cur && chain.length < 10) {
      const pn = parentName.get(cur);
      if (!pn) break;
      chain.push(pn);
      if (pn === 'task') break;
      cur = byName.has(pn) ? v(byName.get(pn).super_class) : null;
    }
    return chain;
  };

  const taskTables = [];
  for (const r of rows) {
    const name = v(r.name);
    if (caseTables.includes(name)) continue;
    const chain = chainOf(r);
    if (chain.at(-1) === 'task') taskTables.push({ name, label: v(r.label), extends: chain.join(' > ') });
  }
  taskTables.sort((a, b) => a.name.localeCompare(b.name));
  log(`tabelas de tarefa no mesmo escopo (estendem task): ${taskTables.length}`);

  // Catalogos dos itens — e por eles que se chega aos portais. `sp_portal` nao
  // tem campo de tabela; o vinculo real e o m2m_sp_portal_catalog.
  const itemIds = (map.itens ?? []).map((i) => i.sys_id).filter(Boolean);
  const links = await fetchByParent(api, 'sc_cat_item_catalog', 'sc_cat_item', itemIds, ['sc_cat_item', 'sc_catalog']);
  const catCount = new Map();
  for (const l of links) {
    const id = v(l.sc_catalog);
    if (id) catCount.set(id, (catCount.get(id) ?? 0) + 1);
  }
  const catalogs = [];
  for (const c of await fetchByIds(api, 'sc_catalog', [...catCount.keys()], ['sys_id', 'title', 'active'])) {
    catalogs.push({
      sys_id: v(c.sys_id),
      title: d(c.title) || v(c.title),
      active: v(c.active),
      items: catCount.get(v(c.sys_id)) ?? 0,
    });
  }
  catalogs.sort((a, b) => b.items - a.items);
  log(`catalogos em uso pelos itens: ${catalogs.length}`);

  return {
    caseTables,
    taskTables,
    tables: [...caseTables, ...taskTables.map((t) => t.name)],
    itemsByTable,
    itemNames: new Map((map.itens ?? []).map((i) => [String(i.sys_id).toLowerCase(), i.name])),
    catalogs,
    scopes: [...scopes.values()],
  };
}

/**
 * Condicoes de notificacao, SLA e report citam o sys_id do item de catalogo
 * direto (`item=6819789d...`). Sem traduzir, a condicao e ilegivel e o elo
 * item -> SLA se perde. Medido nesta instancia: 486 dos 858 SLA, 201 das 467
 * notificacoes e 243 dos 650 reports citam um item do levantamento.
 */
const CONDITION_FIELDS = {
  sysevent_email_action: ['condition'],
  contract_sla: [
    'start_condition', 'stop_condition', 'pause_condition',
    'resume_condition', 'cancel_condition', 'reset_condition',
  ],
  sys_report: ['filter'],
};

/** Troca o sys_id pelo nome do item. O que nao resolve fica como esta. */
function labelIds(text, names) {
  if (!text) return '';
  return text.replace(/[0-9a-f]{32}/gi, (id) => names.get(id.toLowerCase()) ?? id);
}

/**
 * Anota o registro com `<campo>_label` (so quando muda alguma coisa) e com
 * `cited_items[]` — os itens do levantamento citados nas condicoes. E o vinculo
 * fino: a tabela diz "vale para os 148 itens", o cited_items diz para quais.
 */
function linkToItems(out, record, table, names) {
  const cited = new Map();
  for (const field of CONDITION_FIELDS[table] ?? []) {
    const raw = snValue(record[field]);
    if (!raw) continue;
    for (const id of raw.match(/[0-9a-f]{32}/gi) ?? []) {
      const key = id.toLowerCase();
      if (names.has(key)) cited.set(key, names.get(key));
    }
    const labeled = labelIds(raw, names);
    if (labeled !== raw) out[`${field}_label`] = labeled;
  }
  out.cited_items = [...cited].map(([sys_id, name]) => ({ _display_value: name, __text: sys_id }));
  return out;
}

/** Contagem por tabela antes de coletar — e o que o usuario confere. */
export async function previewRelated(api, scope) {
  const rows = [];
  for (const table of scope.tables) {
    rows.push({
      table,
      items: (scope.itemsByTable.get(table) ?? []).length,
      notifications: await api.count('sysevent_email_action', `collection=${table}`),
      sla: await api.count('contract_sla', `collection=${table}^type=SLA`),
      ola: await api.count('contract_sla', `collection=${table}^type=OLA`),
      reports: await api.count('sys_report', `table=${table}`),
    });
  }
  return rows;
}

/**
 * Uma consulta por tabela, nao por item. Alem de ser o barato, evita o limite
 * de URL: 22 nomes de tabela num `IN` ja passam de 700 chars.
 */
async function byTable(api, table, field, tables, fields) {
  const out = [];
  for (const t of tables) out.push(...(await api.queryAll(table, { query: `${field}=${t}`, fields })));
  return out;
}

export async function collectRelated(api, scope, log = () => {}) {
  const notifications = await byTable(api, 'sysevent_email_action', LINK_FIELD.sysevent_email_action, scope.tables, F.NOTIFICATION_FIELDS);
  log(`notificacoes: ${notifications.length}`);

  const slas = await byTable(api, 'contract_sla', LINK_FIELD.contract_sla, scope.tables, F.SLA_FIELDS);
  log(`SLA/OLA: ${slas.length} (${slas.filter((r) => v(r.type) === 'OLA').length} OLA)`);

  const reports = await byTable(api, 'sys_report', LINK_FIELD.sys_report, scope.tables, F.REPORT_FIELDS);
  const shares = await fetchByParent(
    api, 'sys_report_users_groups', 'report_id', reports.map((r) => v(r.sys_id)), F.REPORT_SHARE_FIELDS,
  );
  log(`reports: ${reports.length} (${shares.length} compartilhamentos)`);

  const portalLinks = await fetchByParent(
    api, 'm2m_sp_portal_catalog', 'sc_catalog', scope.catalogs.map((c) => c.sys_id), F.PORTAL_CATALOG_FIELDS,
  );
  const portals = await fetchByIds(api, 'sp_portal', uniq(portalLinks.map((l) => v(l.sp_portal))), F.PORTAL_FIELDS);
  log(`portais que expoem estes catalogos: ${portals.length}`);

  return { notifications, slas, reports, shares, portalLinks, portals };
}

/** Monta as colecoes do contrato. O script cru fica fora do JSON, como no catalogo. */
export function buildRelated(collected, dictionaries, scope, { sourceMap = '' } = {}) {
  const dict = (t) => dictionaries[t] ?? {};
  const scriptsByHash = new Map();
  const scriptIndex = {};

  const takeScript = (record, table, label, field) => {
    const raw = snValue(record[field]);
    if (!raw) return scriptSlot(raw);
    const ref = `${table}:${v(record.sys_id)}:${field}`;
    const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);
    scriptIndex[ref] = hash;
    if (!scriptsByHash.has(hash)) scriptsByHash.set(hash, { hash, label: `${label} (${field})`, script: raw, used_by: [] });
    scriptsByHash.get(hash).used_by.push(ref);
    return scriptSlot(raw);
  };

  const opts = (table) => ({ dictionary: dict(table), listFields: F.RELATED_LIST_FIELDS });
  const txt = (x) => (typeof x === 'string' ? x : '');

  const names = scope.itemNames ?? new Map();

  const notifications = collected.notifications
    .map((n) => {
      const out = shapeRecord(n, F.NOTIFICATION_FIELDS, opts('sysevent_email_action'));
      // O corpo do e-mail fica FORA por decisao do usuario: o que interessa e
      // quando dispara, para quem vai e sob que condicao.
      out.advanced_condition = takeScript(n, 'sysevent_email_action', snValue(n.name), 'advanced_condition');
      return linkToItems(out, n, 'sysevent_email_action', names);
    })
    .sort((a, b) => txt(a.collection).localeCompare(txt(b.collection)) || txt(a.name).localeCompare(txt(b.name)));

  const slas = collected.slas
    .map((s) => linkToItems(shapeRecord(s, F.SLA_FIELDS, opts('contract_sla')), s, 'contract_sla', names))
    .sort((a, b) => txt(a.collection).localeCompare(txt(b.collection))
      || txt(a.type).localeCompare(txt(b.type))
      || txt(a.name).localeCompare(txt(b.name)));

  const sharesByReport = new Map();
  for (const s of collected.shares) {
    const key = v(s.report_id);
    if (!sharesByReport.has(key)) sharesByReport.set(key, []);
    sharesByReport.get(key).push({
      type: v(s.user_id) ? 'user' : 'group',
      _display_value: d(s.user_id) || d(s.group_id) || '',
      __text: v(s.user_id) || v(s.group_id) || '',
    });
  }
  const reports = collected.reports
    .map((r) => {
      const out = shapeRecord(r, F.REPORT_FIELDS, opts('sys_report'));
      out.shared_with = sharesByReport.get(v(r.sys_id)) ?? [];
      return linkToItems(out, r, 'sys_report', names);
    })
    .sort((a, b) => txt(a.table).localeCompare(txt(b.table)) || txt(a.title).localeCompare(txt(b.title)));

  const catalogTitle = new Map(scope.catalogs.map((c) => [c.sys_id, c.title]));
  const linksByPortal = new Map();
  for (const l of collected.portalLinks) {
    const key = v(l.sp_portal);
    if (!linksByPortal.has(key)) linksByPortal.set(key, []);
    linksByPortal.get(key).push({
      _display_value: catalogTitle.get(v(l.sc_catalog)) || d(l.sc_catalog) || '',
      __text: v(l.sc_catalog),
      active: snValue(l.active),
      order: snValue(l.order),
    });
  }
  const portals = collected.portals
    .map((p) => {
      const out = shapeRecord(p, F.PORTAL_FIELDS, opts('sp_portal'));
      out.mapped_catalogs = linksByPortal.get(v(p.sys_id)) ?? [];
      return out;
    })
    .sort((a, b) => txt(a.title).localeCompare(txt(b.title)));

  // Catalogo sem portal nenhum: o item existe mas nao e alcancavel por portal.
  // Pode ser catalogo so de Virtual Agent — ou furo de configuracao.
  const withPortal = new Set(collected.portalLinks.map((l) => v(l.sc_catalog)));

  const _scope = {
    generated_at: new Date().toISOString(),
    source_map: sourceMap,
    application_scopes: scope.scopes,
    case_tables: scope.caseTables.map((t) => ({
      name: t,
      items: (scope.itemsByTable.get(t) ?? []).length,
      item_sys_ids: (scope.itemsByTable.get(t) ?? []).map((i) => i.sys_id),
    })),
    task_tables: scope.taskTables,
    catalogs: scope.catalogs,
    catalogs_without_portal: scope.catalogs.filter((c) => !withPortal.has(c.sys_id)),
    totals: {
      notifications: notifications.length,
      notifications_active: notifications.filter((n) => n.active === 'true').length,
      sla: slas.filter((s) => s.type === 'SLA').length,
      ola: slas.filter((s) => s.type === 'OLA').length,
      // `type` tem um terceiro valor, `Underpinning contract`. Sem esta conta o
      // total de `slas[]` nao fecha com SLA + OLA.
      other: slas.filter((s) => s.type !== 'SLA' && s.type !== 'OLA').length,
      reports: reports.length,
      portals: portals.length,
      // Quantos citam um item do levantamento na condicao — o vinculo fino,
      // mais forte que "vale para a tabela".
      notifications_citing_items: notifications.filter((n) => n.cited_items.length).length,
      slas_citing_items: slas.filter((s) => s.cited_items.length).length,
      reports_citing_items: reports.filter((r) => r.cited_items.length).length,
    },
  };

  return {
    json: { _scope, notifications, slas, reports, portals },
    pendingScripts: [...scriptsByHash.values()],
    scriptIndex,
  };
}
