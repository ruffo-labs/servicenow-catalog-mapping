import { rawValue as v, displayValue as d } from '../tableApi.js';

/**
 * Descobre o que executa cada item — workflow legado e Flow Designer — pelos
 * tres caminhos possiveis, e (opcionalmente) confirma com o historico real de
 * execucao. Ver docs/fulfillment.md.
 *
 * Tudo GET. Ver DIRETRIZ #1.
 */

const CHUNK = 40; // fallback conservador; o normal e calcular por maxIdsPerQuery
const ITEM_TABLES = ['sc_cat_item', 'sc_cat_item_producer'];

const chunks = (arr, n = CHUNK) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/**
 * Campo da tabela destino que referencia de volta o item do catalogo.
 * Na Natura QA e `x_nasm_hr_case.item`, mas o nome varia por instancia — por
 * isso e descoberto no dicionario, nunca chutado.
 */
async function findBackReference(api, table, cache) {
  if (cache.has(table)) return cache.get(table);
  let field = null;
  try {
    // ATENCAO: o campo pode estar numa tabela PAI. Em x_nasm_rtr_case ele nao
    // existe — esta em `task.x_nasm_hr_item`. Procurar so em `name=<table>`
    // fazia a busca voltar vazia e reportar 0 execucoes onde havia milhares.
    const { tableHierarchy } = await import('./collect.js');
    const chain = await tableHierarchy(api, table);
    const rows = await api.queryAll('sys_dictionary', {
      query: `nameIN${chain.join(',')}^internal_type=reference^referenceIN${ITEM_TABLES.join(',')}`,
      fields: ['name', 'element', 'reference'],
      displayValue: 'false',
    });
    // Mais especifico primeiro: campo da propria tabela ganha do campo do pai.
    const ranked = rows
      .map((r) => ({ element: v(r.element), depth: chain.indexOf(v(r.name)) }))
      .filter((r) => r.depth >= 0)
      .sort((a, b) => a.depth - b.depth);
    field = ranked.length ? ranked[0].element : null;
  } catch {
    field = null;
  }
  cache.set(table, field);
  return field;
}

/** Inputs de uma leva de trigger instances: Table, Condition, Run Trigger... */
async function loadTriggerInputs(api, triggerIds) {
  const byTrigger = new Map();
  for (const batch of chunks(triggerIds, api.maxIdsPerQuery('sys_variable_value', { queryOverhead: 60 }))) {
    const rows = await api.queryAll('sys_variable_value', {
      query: `document=sys_hub_trigger_instance^document_keyIN${batch.join(',')}`,
      fields: ['document_key', 'variable', 'value'],
      displayValue: 'all',
    });
    for (const r of rows) {
      const key = v(r.document_key);
      if (!byTrigger.has(key)) byTrigger.set(key, {});
      byTrigger.get(key)[d(r.variable) || v(r.variable)] = v(r.value);
    }
  }
  return byTrigger;
}

/**
 * Triggers cuja CONDICAO cita o sys_id do item. Vinculo exato — nao depende do
 * nome do campo usado na condicao.
 */
async function findTriggersCitingItems(api, itemIds) {
  const hitsByItem = new Map();
  // ^OR agrupa com a condicao anterior: document=X^(valueLIKEa OR valueLIKEb...)
  for (const batch of chunks(itemIds, 20)) {
    const ors = batch.map((id, i) => (i === 0 ? `valueLIKE${id}` : `ORvalueLIKE${id}`)).join('^');
    const rows = await api.queryAll('sys_variable_value', {
      query: `document=sys_hub_trigger_instance^${ors}`,
      fields: ['document_key', 'value'],
      displayValue: 'false',
    });
    for (const r of rows) {
      const value = v(r.value);
      for (const id of batch) {
        if (!value.includes(id)) continue;
        if (!hitsByItem.has(id)) hitsByItem.set(id, []);
        hitsByItem.get(id).push({ triggerId: v(r.document_key), condition: value });
      }
    }
  }
  return hitsByItem;
}

/** Versao publicada de um workflow legado — onde table/condition realmente moram. */
async function loadWorkflowVersions(api, workflowIds) {
  const byWorkflow = new Map();
  for (const batch of chunks(workflowIds, api.maxIdsPerQuery('wf_workflow_version', { fields: ['workflow','table','condition','active','name'], queryOverhead: 30 }))) {
    const rows = await api.queryAll('wf_workflow_version', {
      query: `workflowIN${batch.join(',')}^published=true`,
      fields: ['workflow', 'table', 'condition', 'active', 'name'],
      displayValue: 'false',
    });
    for (const r of rows) byWorkflow.set(v(r.workflow), r);
  }
  return byWorkflow;
}

/**
 * @param {object} opts
 * @param {number} [opts.runtimeSample] 0 desliga a checagem de execucao real
 */
export async function collectFulfillment(api, items, { runtimeSample = 0 } = {}, log = () => {}) {
  const itemIds = items.map((r) => v(r.sys_id));
  const result = new Map(itemIds.map((id) => [id, { workflows: [], flows: [] }]));

  // ---- Caminho 1: workflow legado no campo do item -------------------------
  const workflowByItem = new Map();
  for (const it of items) {
    const wf = v(it.workflow);
    if (wf) workflowByItem.set(v(it.sys_id), wf);
  }
  const versions = await loadWorkflowVersions(api, uniq([...workflowByItem.values()]));
  for (const [itemId, wfId] of workflowByItem) {
    const ver = versions.get(wfId);
    result.get(itemId).workflows.push({
      name: d(items.find((i) => v(i.sys_id) === itemId).workflow) || v(ver?.name) || '',
      sys_id: wfId,
      link: 'item_field',
      table: v(ver?.table),
      condition: v(ver?.condition),
      active: v(ver?.active),
    });
  }

  // ---- Caminho 2: Flow Designer no campo do item ---------------------------
  const flowRefs = new Map();
  for (const it of items) {
    const fl = v(it.flow_designer_flow);
    if (fl) flowRefs.set(v(it.sys_id), { flowId: fl, link: 'item_field' });
  }

  // ---- Caminho 3: trigger cuja condicao cita o sys_id do item --------------
  const citing = await findTriggersCitingItems(api, itemIds);
  const allTriggerIds = uniq([...citing.values()].flat().map((h) => h.triggerId));
  log(`triggers citando os itens: ${allTriggerIds.length}`);

  const triggers = new Map();
  for (const batch of chunks(allTriggerIds, api.maxIdsPerQuery('sys_hub_trigger_instance', { fields: ['sys_id','flow','trigger_definition'] }))) {
    for (const t of await api.queryAll('sys_hub_trigger_instance', {
      query: `sys_idIN${batch.join(',')}`,
      fields: ['sys_id', 'flow', 'trigger_definition'],
    })) triggers.set(v(t.sys_id), t);
  }
  const inputs = await loadTriggerInputs(api, allTriggerIds);

  const flowIds = uniq([
    ...[...flowRefs.values()].map((f) => f.flowId),
    ...[...triggers.values()].map((t) => v(t.flow)),
  ]);
  // Ler da tabela BASE: a trigger pode apontar para o flow vivo (`sys_hub_flow`)
  // ou para um `sys_hub_flow_snapshot` — copia pontual do mesmo flow. Consultar
  // so `sys_hub_flow` deixava metade sem active/status.
  const flows = new Map();
  for (const batch of chunks(flowIds, api.maxIdsPerQuery('sys_hub_flow_base', { fields: ['sys_id','name','active','status','sys_class_name'] }))) {
    for (const f of await api.queryAll('sys_hub_flow_base', {
      query: `sys_idIN${batch.join(',')}`,
      fields: ['sys_id', 'name', 'active', 'status', 'sys_class_name'],
      displayValue: 'false',
    })) flows.set(v(f.sys_id), f);
  }

  for (const [itemId, { flowId, link }] of flowRefs) {
    const f = flows.get(flowId);
    result.get(itemId).flows.push({
      name: v(f?.name), sys_id: flowId, link,
      active: v(f?.active), status: v(f?.status),
      trigger_type: '', trigger_table: '', trigger_condition: '', run_trigger: '',
    });
  }

  for (const [itemId, hits] of citing) {
    // Dedupe por NOME do flow + condicao + gatilho, nao por sys_id: o mesmo flow
    // aparece duas vezes, uma como sys_hub_flow e outra como snapshot. Fica o
    // registro vivo; o snapshot so entra se nao houver o vivo.
    const byKey = new Map();
    for (const hit of hits) {
      const t = triggers.get(hit.triggerId);
      if (!t) continue;
      const flowId = v(t.flow);
      const f = flows.get(flowId);
      const inp = inputs.get(hit.triggerId) ?? {};
      const name = v(f?.name) || d(t.flow) || '';
      const entry = {
        name,
        sys_id: flowId,
        link: 'trigger_condition',
        active: v(f?.active),
        status: v(f?.status),
        trigger_type: d(t.trigger_definition) || '',
        trigger_table: inp.Table ?? '',
        trigger_condition: hit.condition,
        run_trigger: inp['Run Trigger'] ?? '',
      };
      const key = `${name}|${hit.condition}|${entry.trigger_type}`;
      const isLive = v(f?.sys_class_name) === 'sys_hub_flow';
      if (!byKey.has(key) || (isLive && !byKey.get(key).isLive)) {
        byKey.set(key, { entry, isLive });
      }
    }
    for (const { entry } of byKey.values()) result.get(itemId).flows.push(entry);
  }

  // ---- Caminho 3b: fallback por TABELA DESTINO -----------------------------
  // Nem toda instancia condiciona a trigger no sys_id do item. No app de RH da
  // Natura sim (`item=<id>`); no VRM nao — a tabela nem tem campo de volta para
  // o catalogo. Para esses, listar o que dispara na tabela como CANDIDATO.
  const orphans = items.filter(
    (it) => v(it.table_name) && !result.get(v(it.sys_id)).flows.length,
  );
  if (orphans.length) {
    const byTable = new Map();
    for (const it of orphans) {
      const t = v(it.table_name);
      if (!byTable.has(t)) byTable.set(t, []);
      byTable.get(t).push(v(it.sys_id));
    }
    log(`sem vinculo exato: ${orphans.length} item(ns) em ${byTable.size} tabela(s) — buscando candidatos`);

    for (const [table, owners] of byTable) {
      const marks = await api.queryAll('sys_variable_value', {
        query: `document=sys_hub_trigger_instance^value=${table}`,
        fields: ['document_key', 'variable'], displayValue: 'all',
      });
      const ids = marks.filter((m) => (d(m.variable) || '') === 'Table').map((m) => v(m.document_key));
      if (!ids.length) continue;

      const tis = [];
      for (const batch of chunks(ids, api.maxIdsPerQuery('sys_hub_trigger_instance'))) {
        tis.push(...await api.queryAll('sys_hub_trigger_instance', {
          query: `sys_idIN${batch.join(',')}`, fields: ['sys_id', 'flow', 'trigger_definition'],
        }));
      }
      const inp = await loadTriggerInputs(api, ids);
      const fmap = new Map();
      for (const batch of chunks(uniq(tis.map((t) => v(t.flow))))) {
        for (const f of await api.queryAll('sys_hub_flow_base', {
          query: `sys_idIN${batch.join(',')}`,
          fields: ['sys_id', 'name', 'active', 'status', 'sys_class_name'],
          displayValue: 'false',
        })) fmap.set(v(f.sys_id), f);
      }

      // Execucao real no ESCOPO DA TABELA (nao do item) — a tabela nao tem como
      // atribuir o registro ao producer, entao o numero vale para a tabela toda.
      let execs = new Map();
      let lastByName = new Map();
      if (runtimeSample) {
        execs = await api.groupCount('sys_flow_context', 'name', `source_table=${table}`);
        const recent = await api.query('sys_flow_context', {
          query: `source_table=${table}^ORDERBYDESCsys_created_on`,
          fields: ['name', 'sys_created_on'], limit: 200, displayValue: 'false',
        });
        for (const c of recent.records) {
          const n = v(c.name);
          if (!lastByName.has(n)) lastByName.set(n, v(c.sys_created_on));
        }
      }

      const byKey = new Map();
      for (const t of tis) {
        const f = fmap.get(v(t.flow));
        const name = v(f?.name) || d(t.flow) || '';
        const i = inp.get(v(t.sys_id)) ?? {};
        const condition = i.Condition ?? '';
        const triggerType = d(t.trigger_definition) || '';
        const key = `${name}|${condition}|${triggerType}`;
        const isLive = v(f?.sys_class_name) === 'sys_hub_flow';
        if (byKey.has(key) && !(isLive && !byKey.get(key).isLive)) continue;
        byKey.set(key, {
          isLive,
          entry: {
            name, sys_id: v(t.flow), link: 'target_table',
            active: v(f?.active), status: v(f?.status),
            trigger_type: triggerType, trigger_table: i.Table ?? '',
            trigger_condition: condition, run_trigger: i['Run Trigger'] ?? '',
            ...(runtimeSample ? {
              executions: {
                count: String(execs.get(name) ?? 0),
                last: lastByName.get(name) ?? '',
                scope: 'table',
              },
            } : {}),
          },
        });
      }
      const candidates = [...byKey.values()].map((x) => x.entry);

      // Uma trigger cuja condicao cita o sys_id de OUTRO item de catalogo e,
      // por definicao, daquele outro item — nao candidata deste. Sem esse
      // filtro, numa tabela com 148 producers cada orfao herdava as 200+
      // triggers alheias (9.008 entradas inuteis e 23 MB de JSON).
      const cited = uniq(candidates.flatMap(
        (c) => (c.trigger_condition.match(/[0-9a-f]{32}/gi) ?? []).map((s) => s.toLowerCase()),
      ));
      const isCatalogItem = new Set();
      for (const batch of chunks(cited, api.maxIdsPerQuery('sc_cat_item', { fields: ['sys_id'] }))) {
        for (const r of await api.queryAll('sc_cat_item', {
          query: `sys_idIN${batch.join(',')}`, fields: ['sys_id'], displayValue: 'false',
        })) isCatalogItem.add(v(r.sys_id).toLowerCase());
      }

      for (const owner of owners) {
        const mine = candidates.filter((c) => {
          const ids = (c.trigger_condition.match(/[0-9a-f]{32}/gi) ?? []).map((s) => s.toLowerCase());
          const outros = ids.filter((id) => isCatalogItem.has(id) && id !== owner.toLowerCase());
          return outros.length === 0;
        });
        result.get(owner).flows.push(...mine.map((c) => ({ ...c })));
      }
    }
  }

  if (!runtimeSample) return result;

  // ---- Runtime: o que REALMENTE rodou --------------------------------------
  // Amostra os N registros mais recentes por item. Varrer tudo e inviavel:
  // um unico producer tinha 11.553 registros. Ver docs/fulfillment.md.
  log(`checando execucao real (amostra de ${runtimeSample} registros por item)...`);
  const backRefCache = new Map();
  const recordOwner = new Map();

  for (const it of items) {
    const table = v(it.table_name);
    if (!table) continue;
    const field = await findBackReference(api, table, backRefCache);
    if (!field) continue;
    const page = await api.query(table, {
      query: `${field}=${v(it.sys_id)}^ORDERBYDESCsys_created_on`,
      fields: ['sys_id'], limit: runtimeSample, displayValue: 'false',
    });
    for (const r of page.records) recordOwner.set(v(r.sys_id), v(it.sys_id));
  }

  const execByItem = new Map();
  for (const batch of chunks([...recordOwner.keys()])) {
    const ctx = await api.queryAll('sys_flow_context', {
      query: `source_recordIN${batch.join(',')}`,
      fields: ['name', 'source_record', 'sys_created_on'],
      displayValue: 'false',
    });
    for (const c of ctx) {
      const owner = recordOwner.get(v(c.source_record));
      if (!owner) continue;
      if (!execByItem.has(owner)) execByItem.set(owner, new Map());
      const byName = execByItem.get(owner);
      const name = v(c.name);
      const cur = byName.get(name) ?? { count: 0, last: '' };
      cur.count++;
      if (v(c.sys_created_on) > cur.last) cur.last = v(c.sys_created_on);
      byName.set(name, cur);
    }
  }

  // Workflow legado: RITMs do item -> wf_context
  for (const it of items) {
    const itemId = v(it.sys_id);
    if (!result.get(itemId).workflows.length) continue;
    const ritms = await api.query('sc_req_item', {
      query: `cat_item=${itemId}^ORDERBYDESCsys_created_on`,
      fields: ['sys_id'], limit: runtimeSample, displayValue: 'false',
    });
    const ids = ritms.records.map((r) => v(r.sys_id));
    if (!ids.length) continue;
    const ctx = await api.queryAll('wf_context', {
      query: `idIN${ids.join(',')}`, fields: ['name', 'sys_created_on'], displayValue: 'false',
    });
    for (const w of result.get(itemId).workflows) {
      const mine = ctx.filter((c) => v(c.name) === w.name);
      w.executions = {
        count: String(mine.length),
        last: mine.map((c) => v(c.sys_created_on)).sort().at(-1) ?? '',
        sample_size: String(runtimeSample),
      };
    }
  }

  for (const [itemId, entry] of result) {
    const byName = execByItem.get(itemId) ?? new Map();
    for (const f of entry.flows) {
      // Candidato por tabela ja tem contagem no escopo da tabela — nao sobrescrever.
      if (f.executions?.scope === 'table') continue;
      const hit = byName.get(f.name);
      f.executions = {
        count: String(hit?.count ?? 0),
        last: hit?.last ?? '',
        scope: 'item',
        sample_size: String(runtimeSample),
      };
    }
  }

  return result;
}
