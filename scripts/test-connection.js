#!/usr/bin/env node
/**
 * Valida credenciais, permissões de leitura e descobre o que esta instância
 * realmente expõe. Não escreve nada — nem na instância, nem em disco.
 */
import { TableApi, rawValue } from '../src/tableApi.js';
import { ServiceNowClient, ReadOnlyViolationError } from '../src/snClient.js';

const CATALOG_TABLES = [
  'sc_cat_item',
  'sc_cat_item_producer',
  'item_option_new',
  'item_option_new_set',
  'io_set_item',
  'question_choice',
  'catalog_ui_policy',
  'catalog_ui_policy_action',
  'catalog_script_client',
  'sc_catalog',
  'sc_category',
  'sc_cat_item_catalog',
  'sc_cat_item_category',
  'sc_cat_item_user_criteria_mtom',
  'sc_cat_item_user_criteria_no_mtom',
];

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

async function main() {
  const client = new ServiceNowClient();
  const api = new TableApi(client);
  console.log(`\nInstância: ${client.config.instanceUrl}  (auth: ${client.config.authType})\n`);

  console.log('Guarda read-only:');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    try {
      await client.request('/api/now/table/incident', { method });
      bad(`${method} NÃO foi bloqueado — PARE e investigue`);
      process.exitCode = 1;
    } catch (err) {
      if (err instanceof ReadOnlyViolationError) ok(`${method} bloqueado`);
      else { bad(`${method} falhou por outro motivo: ${err.message}`); process.exitCode = 1; }
    }
  }

  console.log('\nIdentidade:');
  const me = await client.request('/api/now/table/sys_user', {
    query: { sysparm_query: `user_name=${client.config.username ?? ''}`, sysparm_limit: 1, sysparm_fields: 'user_name,name,sys_id' },
  }).then((r) => r.result?.[0]).catch(() => null);
  ok(me ? `autenticado como ${rawValue(me.name)} (${rawValue(me.user_name)})` : 'autenticado (sys_user não legível para este usuário)');

  console.log('\nLeitura das tabelas do catálogo:');
  for (const table of CATALOG_TABLES) {
    try {
      const n = await api.count(table);
      ok(`${table.padEnd(36)} ${n} registro(s)`);
    } catch (err) {
      bad(`${table.padEnd(36)} ${err.status ?? ''} ${err.message.slice(0, 80)}`);
    }
  }

  console.log('\nMapa de item_option_new.type nesta instância:');
  try {
    // 'type' e herdado da tabela question — o sys_choice fica la, nao em item_option_new.
    const choices = await api.getFieldChoices('question', 'type');
    const entries = Object.entries(choices).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [v, label] of entries) console.log(`  ${String(v).padStart(3)} = ${label}`);
    if (!entries.length) bad('nenhuma choice encontrada — verificar idioma/ACL de sys_choice');
  } catch (err) {
    bad(err.message);
  }

  console.log('\nMotor de fulfillment disponível em sc_cat_item:');
  for (const field of ['workflow', 'flow_designer_flow', 'flow_catalog_item']) {
    console.log(`  ${(await api.hasField('sc_cat_item', field)) ? '✓' : '–'} ${field}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}\n`);
  process.exit(1);
});
