#!/usr/bin/env node
/**
 * Testa a transformacao (shape + build) com dados falsos, sem tocar em rede.
 * Serve para provar o formato de saida antes de haver instancia configurada.
 */
import { strict as assert } from 'node:assert';
import { build } from '../src/catalog/build.js';
import { snRef, snList, labelConditions } from '../src/catalog/shape.js';

const f = (value, display = value) => ({ value, display_value: display });

console.log('\nshape');
assert.equal(snRef(f('', '')), '', 'referencia vazia vira ""');
assert.deepEqual(snRef(f('abc', 'Mobiles')), { _display_value: 'Mobiles', __text: 'abc' });
assert.deepEqual(snList(f('id1', 'Admin')), { _display_value: 'Admin', __text: 'id1' });
assert.equal(snList(f('id1,id2', 'Admin, ITIL')), 'Admin, ITIL', 'lista multipla vira so os nomes');
assert.equal(snList(f('', '')), '');
assert.equal(
  labelConditions('IO:ee5d87ca9747011021983d1e6253af57=yes^EQ', new Map([['ee5d87ca9747011021983d1e6253af57', 'is_new']])),
  'IO:is_new=yes^EQ',
);
assert.equal(labelConditions('IO:ffffffffffffffffffffffffffffffff=1', new Map()), 'IO:ffffffffffffffffffffffffffffffff=1', 'nao resolvido fica visivel');
console.log('  ok');

console.log('\nbuild');
const dictionaries = {
  sc_cat_item: { category: { isReference: true }, flow_designer_flow: { isReference: true }, workflow: { isReference: true } },
  item_option_new: { cat_item: { isReference: true }, variable_set: { isReference: true } },
  catalog_script_client: { cat_item: { isReference: true } },
  user_criteria: {},
  question_choice: {},
  catalog_ui_policy: { catalog_item: { isReference: true } },
  catalog_ui_policy_action: { ui_policy: { isReference: true } },
};

const producer = {
  sys_id: f('rp1'), sys_class_name: f('sc_cat_item_producer'), name: f('Abrir chamado'),
  active: f('true'), category: f('cat1', 'Mobiles'), sc_catalogs: f('c1,c2', 'Service Catalog, HR'),
  workflow: f('', ''), flow_designer_flow: f('', ''), type: f('record_producer'),
  table_name: f('incident'), redirect_url: f('home.do'), view: f(''),
  post_insert_script: f('gs.addInfoMessage("ok");'), save_script: f(''),
  script: f('current.short_description = producer.titulo;'),
};
const variable = {
  sys_id: f('v1'), name: f('urgencia'), type: f('5', 'Select Box'),
  cat_item: f('rp1', 'Abrir chamado'), variable_set: f('', ''), default_value: f('2'),
};
const SHARED = 'var ga = new GlideAjax("X");';
const clientScript = { sys_id: f('cs1'), name: f('Set urgencia'), script: f(SHARED), cat_item: f('rp1', 'Abrir chamado') };
// mesmo script, outro registro: tem que ser explicado UMA vez so
const clientScriptCopy = { sys_id: f('cs2'), name: f('Set urgencia (copia)'), script: f(SHARED), cat_item: f('rp1', 'Abrir chamado') };

const { json, pendingScripts, scriptIndex } = build({
  items: [producer],
  producerIds: new Set(['rp1']),
  variablesByItem: new Map([['rp1', [variable]]]),
  variablesBySet: new Map(),
  choicesByVariable: new Map([['v1', [{ sys_id: f('ch1'), text: f('Alta'), value: f('1'), order: f('100'), inactive: f('false') }]]]),
  setLinksByItem: new Map(), sets: [],
  policiesByItem: new Map(), policiesBySet: new Map(), actionsByPolicy: new Map(),
  scriptsByItem: new Map([['rp1', [clientScript, clientScriptCopy]]]), scriptsBySet: new Map(),
  availableByItem: new Map(), notAvailableByItem: new Map(),
  userCriteria: [], allVariables: [variable],
  fulfillmentByItem: new Map([['rp1', {
    workflows: [],
    flows: [
      { name: 'EY: Flow Vivo', sys_id: 'f1', link: 'trigger_condition', active: 'true', status: 'published', trigger_type: 'Criacao em', trigger_table: 'incident', trigger_condition: 'item=rp1', run_trigger: 'once', executions: { count: '4', last: '2026-09-15 21:55:57', sample_size: '50' } },
      { name: 'Flow Carcaca', sys_id: 'f2', link: 'trigger_condition', active: 'false', status: 'published', trigger_type: 'Criacao em', trigger_table: 'incident', trigger_condition: 'item=rp1', run_trigger: 'once', executions: { count: '0', last: '', sample_size: '50' } },
    ],
  }]]),
}, dictionaries);

const item = json.itens[0];
assert.equal(item.workflow, '', 'referencia vazia sai como ""');
assert.deepEqual(item.category, { _display_value: 'Mobiles', __text: 'cat1' });
assert.equal(item.sc_catalogs, 'Service Catalog, HR', 'glide list multipla sai so com os nomes');
assert.equal(item.table_name, 'incident', 'campo da classe filha foi mesclado');
assert.deepEqual(item.script, { script_understanding: null }, 'slot de script do RP criado');
assert.equal(item.catalog_variables[0].type, '5');
assert.equal(item.catalog_variables[0].type_label, 'Select Box', 'type_label logo depois do type');
assert.equal(item.catalog_variables[0].question_choices.length, 1, 'choices mapeadas');
assert.equal(item.catalog_variables[0].default_value, '2');
assert.deepEqual(item.catalog_client_script[0].script, { script_understanding: null });
assert.equal(pendingScripts.length, 3, 'script + post_insert_script do RP + 1 client script unico');
const shared = pendingScripts.find((p) => p.script === SHARED);
assert.equal(shared.used_by.length, 2, 'os dois registros apontam para o mesmo hash');
assert.equal(scriptIndex['catalog_script_client:cs1:script'], scriptIndex['catalog_script_client:cs2:script'], 'mesmo script, mesmo hash');
assert.equal(Object.keys(scriptIndex).length, 4, 'index cobre toda ocorrencia');
assert.deepEqual(item.post_insert_script, { script_understanding: null }, 'post_insert_script ganha slot');
assert.equal(item.save_script, '', 'save_script vazio sai como ""');
assert.ok(scriptIndex['sc_cat_item_producer:rp1:post_insert_script'], 'chave inclui o campo');
assert.ok(pendingScripts.every((p) => p.script), 'script cru fica so na fila, fora do JSON');
assert.ok(!JSON.stringify(json).includes('GlideAjax'), 'script cru nao vaza para o JSON final');

assert.equal(item.triggered_workflows.length, 0, 'sem workflow legado');
assert.equal(item.triggered_flow_designers.length, 2, 'dois flows vinculados');
const vivo = item.triggered_flow_designers.find(f => f.active === 'true');
assert.equal(vivo.executions.count, '4', 'flow ativo tem execucao');
assert.equal(vivo.link, 'trigger_condition', 'link registra o grau de confianca');
const carcaca = item.triggered_flow_designers.find(f => f.active === 'false');
assert.equal(carcaca.executions.count, '0', 'flow inativo sem execucao — o caso NAT&CO');

const keys = Object.keys(item.catalog_variables[0]);
assert.equal(keys[keys.indexOf('type') + 1], 'type_label');
console.log('  ok');

console.log('\nJSON de exemplo gerado:\n');
console.log(JSON.stringify(json, null, 2).split('\n').slice(0, 40).join('\n'));
console.log('  ...\n\nTudo passou.\n');
