import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { rawValue } from '../tableApi.js';
import * as F from './fields.js';
import { describeTable } from './collect.js';
import { shapeRecord, snValue, scriptSlot, labelConditions } from './shape.js';

const TABLES = {
  sc_cat_item: F.ITEM_FIELDS,
  sc_cat_item_producer: F.PRODUCER_FIELDS,
  item_option_new: F.VARIABLE_FIELDS,
  item_option_new_set: F.SET_FIELDS,
  io_set_item: F.SET_LINK_FIELDS,
  question_choice: F.CHOICE_FIELDS,
  catalog_ui_policy: F.UI_POLICY_FIELDS,
  catalog_ui_policy_action: F.UI_POLICY_ACTION_FIELDS,
  catalog_script_client: F.CLIENT_SCRIPT_FIELDS,
  sc_cat_item_user_criteria_mtom: F.UC_LINK_FIELDS,
  sc_cat_item_user_criteria_no_mtom: F.UC_LINK_FIELDS,
  user_criteria: F.USER_CRITERIA_FIELDS,
};

const DICT_TTL_DAYS = 7;

/** Caminho do cache de dicionario, separado por instancia. */
function dictCachePath(api) {
  const host = new URL(api.client.config.instanceUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
  return resolve(process.cwd(), `.cache/dictionary-${host}.json`);
}

/**
 * Le o dicionario de todas as tabelas envolvidas e avisa sobre campos inexistentes.
 *
 * Custa 58 chamadas fixas (12 tabelas x caminhar a heranca), independente de
 * quantos itens forem mapeados: por isso fica em cache por instancia. O
 * dicionario so muda quando alguem altera a estrutura da instancia, entao o TTL
 * e de 7 dias; `refresh: true` ignora o cache.
 */
export async function loadDictionaries(api, log = () => {}, { refresh = false } = {}) {
  const cachePath = dictCachePath(api);

  if (!refresh && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      const ageDays = (Date.now() - new Date(cached.generated_at).getTime()) / 86_400_000;
      if (ageDays < DICT_TTL_DAYS && cached.dictionaries) {
        log(`dicionario do cache (${Math.round(ageDays * 24)}h, 0 chamadas): --refresh-dict para reler`);
        for (const w of cached.warnings ?? []) log(`AVISO  ${w}`);
        return { dictionaries: cached.dictionaries, warnings: cached.warnings ?? [], cached: true };
      }
    } catch {
      // cache corrompido: segue e regrava
    }
  }

  const dictionaries = {};
  const warnings = [];
  for (const [table, fields] of Object.entries(TABLES)) {
    try {
      const { dictionary, missing } = await describeTable(api, table, fields);
      dictionaries[table] = dictionary;
      if (missing.length) warnings.push(`${table}: campo(s) inexistente(s) nesta instancia -> ${missing.join(', ')}`);
    } catch (err) {
      dictionaries[table] = {};
      warnings.push(`${table}: dicionario nao pode ser lido (${err.message})`);
    }
  }
  for (const w of warnings) log(`AVISO  ${w}`);

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({
    generated_at: new Date().toISOString(),
    instance: api.client.config.instanceUrl,
    dictionaries,
    warnings,
  }, null, 2), 'utf8');

  return { dictionaries, warnings, cached: false };
}

const CHOICE_OUT = ['text', 'value', 'order', 'inactive', 'sys_id'];

/**
 * Monta o JSON do contrato a partir da coleta.
 * Devolve tambem `pendingScripts` (scripts crus unicos, deduplicados por hash)
 * e `scriptIndex` (ref -> hash). Nada disso entra no JSON final.
 */
export function build(collected, dictionaries) {
  // Scripts identicos (copia-e-cola entre itens) sao explicados UMA vez.
  const scriptsByHash = new Map();
  const scriptIndex = {};
  const dict = (t) => dictionaries[t] ?? {};

  // sys_id da variavel -> nome, para traduzir os IO:<sys_id> das condicoes
  const variableNameById = new Map(
    collected.allVariables.map((v) => [rawValue(v.sys_id).toLowerCase(), rawValue(v.name)]),
  );

  // O campo entra na chave: um mesmo record producer tem ate tres scripts.
  const takeScript = (record, table, label, field = 'script') => {
    const raw = snValue(record[field]);
    if (!raw) return scriptSlot(raw);
    const ref = `${table}:${rawValue(record.sys_id)}:${field}`;
    const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);
    scriptIndex[ref] = hash;
    if (!scriptsByHash.has(hash)) {
      scriptsByHash.set(hash, { hash, label: `${label} (${field})`, script: raw, used_by: [] });
    }
    scriptsByHash.get(hash).used_by.push(ref);
    return scriptSlot(raw);
  };

  const buildVariable = (v) => {
    const out = shapeRecord(v, F.VARIABLE_FIELDS, {
      dictionary: dict('item_option_new'),
      labels: ['type'],
    });
    // Regra do contrato: se existe choice cadastrada, mapeia -- independente do type.
    const choices = collected.choicesByVariable.get(rawValue(v.sys_id)) ?? [];
    if (choices.length) {
      out.question_choices = choices.map((c) =>
        shapeRecord(c, CHOICE_OUT, { dictionary: dict('question_choice') }),
      );
    }
    return out;
  };

  const buildPolicies = (policies) =>
    policies.map((p) => {
      const out = shapeRecord(p, F.UI_POLICY_FIELDS, { dictionary: dict('catalog_ui_policy') });
      out.catalog_conditions_label = labelConditions(snValue(p.catalog_conditions), variableNameById);
      out.ui_policy_actions = (collected.actionsByPolicy.get(rawValue(p.sys_id)) ?? []).map((a) =>
        shapeRecord(a, F.UI_POLICY_ACTION_FIELDS, { dictionary: dict('catalog_ui_policy_action') }),
      );
      return out;
    });

  const buildClientScripts = (scripts) =>
    scripts.map((s) => {
      const out = shapeRecord(s, F.CLIENT_SCRIPT_FIELDS, { dictionary: dict('catalog_script_client') });
      out.script = takeScript(s, 'catalog_script_client', snValue(s.name));
      return out;
    });

  const itens = collected.items.map((item) => {
    const id = rawValue(item.sys_id);
    const out = shapeRecord(item, F.ITEM_FIELDS, { dictionary: dict('sc_cat_item') });

    // Record producer ja veio lido da sc_cat_item_producer, com base + campos proprios.
    if (collected.producerIds?.has(id)) {
      out.table_name = snValue(item.table_name);
      out.redirect_url = snValue(item.redirect_url);
      out.view = snValue(item.view);
      for (const field of ['script', 'post_insert_script', 'save_script']) {
        out[field] = takeScript(item, 'sc_cat_item_producer', snValue(item.name), field);
      }
    }

    out.catalog_variables = (collected.variablesByItem.get(id) ?? []).map(buildVariable);
    out.catalog_variable_sets = (collected.setLinksByItem.get(id) ?? []).map((l) =>
      shapeRecord(l, F.SET_LINK_FIELDS, { dictionary: dict('io_set_item') }),
    );
    out.catalog_ui_policies = buildPolicies(collected.policiesByItem.get(id) ?? []);
    out.catalog_client_script = buildClientScripts(collected.scriptsByItem.get(id) ?? []);
    const ff = collected.fulfillmentByItem?.get(id) ?? { workflows: [], flows: [] };
    out.triggered_workflows = ff.workflows;
    out.triggered_flow_designers = ff.flows;
    out.catalog_available_for = (collected.availableByItem.get(id) ?? []).map((l) =>
      shapeRecord(l, F.UC_LINK_FIELDS, { dictionary: dict('sc_cat_item_user_criteria_mtom') }),
    );
    out.catalog_not_available_for = (collected.notAvailableByItem.get(id) ?? []).map((l) =>
      shapeRecord(l, F.UC_LINK_FIELDS, { dictionary: dict('sc_cat_item_user_criteria_no_mtom') }),
    );
    return out;
  });

  const variable_sets = collected.sets.map((set) => {
    const id = rawValue(set.sys_id);
    const out = shapeRecord(set, F.SET_FIELDS, { dictionary: dict('item_option_new_set') });
    out.vs_variables = (collected.variablesBySet.get(id) ?? []).map(buildVariable);
    out.vs_ui_policies = buildPolicies(collected.policiesBySet.get(id) ?? []);
    out.vs_catalog_client_scripts = buildClientScripts(collected.scriptsBySet.get(id) ?? []);
    return out;
  });

  const user_criteria = collected.userCriteria.map((uc) => {
    const out = shapeRecord(uc, F.USER_CRITERIA_FIELDS, { dictionary: dict('user_criteria') });
    out.script = takeScript(uc, 'user_criteria', snValue(uc.name));
    return out;
  });

  return {
    json: { itens, variable_sets, user_criteria },
    pendingScripts: [...scriptsByHash.values()],
    scriptIndex,
  };
}
