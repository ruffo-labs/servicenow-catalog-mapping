import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { build } from '../src/catalog/build.js';
import { snRef, snList, labelConditions } from '../src/catalog/shape.js';

/**
 * Testa a transformacao (shape + build) com dados falsos, sem tocar em rede.
 * Prova o contrato de saida descrito em docs/output-schema.md.
 */

const f = (value, display = value) => ({ value, display_value: display });

test('referencia vazia vira string vazia', () => {
  assert.equal(snRef(f('', '')), '');
});

test('referencia preenchida vira objeto display/text', () => {
  assert.deepEqual(snRef(f('abc', 'Mobiles')), { _display_value: 'Mobiles', __text: 'abc' });
});

test('glide list com um valor mantem a forma de referencia', () => {
  assert.deepEqual(snList(f('id1', 'Admin')), { _display_value: 'Admin', __text: 'id1' });
});

test('glide list com varios valores vira so os nomes', () => {
  assert.equal(snList(f('id1,id2', 'Admin, ITIL')), 'Admin, ITIL');
});

test('condicao com IO resolve para o nome da variavel', () => {
  const nomes = new Map([['ee5d87ca9747011021983d1e6253af57', 'is_new']]);
  assert.equal(
    labelConditions('IO:ee5d87ca9747011021983d1e6253af57=yes^EQ', nomes),
    'IO:is_new=yes^EQ',
  );
});

test('IO nao resolvido continua visivel em vez de sumir', () => {
  const cru = 'IO:ffffffffffffffffffffffffffffffff=1';
  assert.equal(labelConditions(cru, new Map()), cru);
});

// ---------------------------------------------------------------------------

const dictionaries = {
  sc_cat_item: {
    category: { isReference: true },
    flow_designer_flow: { isReference: true },
    workflow: { isReference: true },
  },
  item_option_new: { cat_item: { isReference: true }, variable_set: { isReference: true } },
  catalog_script_client: { cat_item: { isReference: true } },
  user_criteria: {},
  question_choice: {},
  catalog_ui_policy: { catalog_item: { isReference: true } },
  catalog_ui_policy_action: { ui_policy: { isReference: true } },
};

const SHARED = 'var ga = new GlideAjax("X");';

function buildFixture() {
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
  const clientScript = {
    sys_id: f('cs1'), name: f('Set urgencia'), script: f(SHARED), cat_item: f('rp1', 'Abrir chamado'),
  };
  // Mesmo script, outro registro: precisa ser explicado uma vez so.
  const clientScriptCopy = {
    sys_id: f('cs2'), name: f('Set urgencia (copia)'), script: f(SHARED), cat_item: f('rp1', 'Abrir chamado'),
  };

  return build({
    items: [producer],
    producerIds: new Set(['rp1']),
    variablesByItem: new Map([['rp1', [variable]]]),
    variablesBySet: new Map(),
    choicesByVariable: new Map([['v1', [
      { sys_id: f('ch1'), text: f('Alta'), value: f('1'), order: f('100'), inactive: f('false') },
    ]]]),
    setLinksByItem: new Map(), sets: [],
    policiesByItem: new Map(), policiesBySet: new Map(), actionsByPolicy: new Map(),
    scriptsByItem: new Map([['rp1', [clientScript, clientScriptCopy]]]), scriptsBySet: new Map(),
    availableByItem: new Map(), notAvailableByItem: new Map(),
    userCriteria: [], allVariables: [variable],
    fulfillmentByItem: new Map([['rp1', {
      workflows: [],
      flows: [
        {
          name: 'EY: Flow Vivo', sys_id: 'f1', link: 'trigger_condition', active: 'true',
          status: 'published', trigger_type: 'Criacao em', trigger_table: 'incident',
          trigger_condition: 'item=rp1', run_trigger: 'once',
          executions: { count: '4', last: '2026-09-15 21:55:57', scope: 'item', sample_size: '50' },
        },
        {
          name: 'Flow Carcaca', sys_id: 'f2', link: 'trigger_condition', active: 'false',
          status: 'published', trigger_type: 'Criacao em', trigger_table: 'incident',
          trigger_condition: 'item=rp1', run_trigger: 'once',
          executions: { count: '0', last: '', scope: 'item', sample_size: '50' },
        },
      ],
    }]]),
  }, dictionaries);
}

test('referencia vazia sai como string vazia no item', () => {
  const { json } = buildFixture();
  assert.equal(json.itens[0].workflow, '');
});

test('campos da classe filha sao mesclados no record producer', () => {
  const { json } = buildFixture();
  assert.equal(json.itens[0].table_name, 'incident');
  assert.equal(json.itens[0].redirect_url, 'home.do');
});

test('os tres scripts do producer viram slot de entendimento', () => {
  const { json } = buildFixture();
  assert.deepEqual(json.itens[0].script, { script_understanding: null });
  assert.deepEqual(json.itens[0].post_insert_script, { script_understanding: null });
  assert.equal(json.itens[0].save_script, '', 'script vazio sai como string vazia');
});

test('type_label vem logo depois do type', () => {
  const { json } = buildFixture();
  const variavel = json.itens[0].catalog_variables[0];
  assert.equal(variavel.type, '5');
  assert.equal(variavel.type_label, 'Select Box');
  const chaves = Object.keys(variavel);
  assert.equal(chaves[chaves.indexOf('type') + 1], 'type_label');
});

test('choices sao mapeadas quando existem', () => {
  const { json } = buildFixture();
  assert.equal(json.itens[0].catalog_variables[0].question_choices.length, 1);
});

test('script identico e deduplicado por hash', () => {
  const { pendingScripts, scriptIndex } = buildFixture();
  const compartilhado = pendingScripts.find((p) => p.script === SHARED);
  assert.equal(compartilhado.used_by.length, 2, 'os dois registros apontam para o mesmo hash');
  assert.equal(
    scriptIndex['catalog_script_client:cs1:script'],
    scriptIndex['catalog_script_client:cs2:script'],
  );
});

test('a chave do indice inclui o campo, porque o producer tem tres scripts', () => {
  const { scriptIndex } = buildFixture();
  assert.ok(scriptIndex['sc_cat_item_producer:rp1:post_insert_script']);
  assert.equal(Object.keys(scriptIndex).length, 4);
});

test('DIRETRIZ #3: o script cru nunca vaza para o JSON final', () => {
  const { json, pendingScripts } = buildFixture();
  assert.ok(!JSON.stringify(json).includes('GlideAjax'), 'script cru no JSON final');
  assert.ok(pendingScripts.every((p) => p.script), 'o cru fica so na fila da fase 2');
});

test('fulfillment distingue flow vivo de carcaca', () => {
  const { json } = buildFixture();
  const flows = json.itens[0].triggered_flow_designers;
  assert.equal(json.itens[0].triggered_workflows.length, 0);
  assert.equal(flows.length, 2);

  const vivo = flows.find((x) => x.active === 'true');
  assert.equal(vivo.executions.count, '4');
  assert.equal(vivo.link, 'trigger_condition', 'link registra o grau de confianca');

  const carcaca = flows.find((x) => x.active === 'false');
  assert.equal(carcaca.executions.count, '0');
});
