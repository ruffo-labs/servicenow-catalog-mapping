#!/usr/bin/env node
/**
 * Mostra o que existe na instancia para ajudar a escolher o filtro do extract.
 * Somente leitura, como todo o resto.
 *
 *   node scripts/explore.js              # catalogos, classes e categorias
 *   node scripts/explore.js --catalog <sys_id>   # categorias e itens desse catalogo
 */
import { TableApi, rawValue } from '../src/tableApi.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const catalog = flag('catalog');

const api = new TableApi();
const v = rawValue;

async function main() {
  const scope = catalog ? `^sc_catalogsLIKE${catalog}` : '';

  console.log('\nCATALOGOS');
  const catalogs = await api.queryAll('sc_catalog', {
    query: 'active=true^ORDERBYtitle', fields: ['sys_id', 'title'],
  });
  for (const c of catalogs) {
    const id = v(c.sys_id);
    const total = await api.count('sc_cat_item', `active=true^sc_catalogsLIKE${id}`);
    console.log(`  ${id}  ${String(total).padStart(5)} itens  ${v(c.title)}`);
  }

  console.log(`\nPOR CLASSE${catalog ? ' (neste catalogo)' : ''}`);
  const classes = [
    ['sc_cat_item', 'Item de catalogo'],
    ['sc_cat_item_producer', 'Record Producer'],
    ['sc_cat_item_order_guide', 'Order Guide'],
    ['sc_cat_item_content', 'Content Item'],
    ['sc_cat_item_wizard', 'Wizard'],
  ];
  for (const [cls, label] of classes) {
    const n = await api.count('sc_cat_item', `active=true^sys_class_name=${cls}${scope}`);
    if (n) console.log(`  ${String(n).padStart(5)}  ${label.padEnd(18)} ${cls}`);
  }

  console.log(`\nCATEGORIAS${catalog ? ' (neste catalogo)' : ''}: top 15 por volume`);
  const categories = await api.queryAll('sc_category', {
    query: `active=true${catalog ? `^sc_catalog=${catalog}` : ''}`,
    fields: ['sys_id', 'title'],
  });
  const counted = [];
  for (const c of categories) {
    const id = v(c.sys_id);
    const n = await api.count('sc_cat_item', `active=true^category=${id}`);
    if (n) counted.push({ id, title: v(c.title), n });
  }
  for (const c of counted.sort((a, b) => b.n - a.n).slice(0, 15)) {
    console.log(`  ${c.id}  ${String(c.n).padStart(5)} itens  ${c.title}`);
  }

  console.log('\nAMOSTRA: 10 record producers (bons candidatos para o primeiro teste)');
  const sample = await api.query('sc_cat_item', {
    query: `active=true^sys_class_name=sc_cat_item_producer${scope}^ORDERBYname`,
    fields: ['sys_id', 'name'], limit: 10,
  });
  for (const r of sample.records) console.log(`  ${v(r.sys_id)}  ${v(r.name)}`);

  console.log(`
Escolha um filtro e rode, por exemplo:
  node scripts/extract.js --sys-id <sys_id>
  node scripts/extract.js --catalog <sys_id> --kind producer
`);
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}\n`);
  process.exit(1);
});
