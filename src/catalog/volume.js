import { rawValue as v } from '../tableApi.js';

/**
 * Quantos chamados cada item ja gerou. E o numero que responde "qual item
 * atacar primeiro numa refatoracao".
 *
 * Tudo por Aggregate API (`/api/now/stats`) com `sysparm_group_by`: uma
 * chamada resolve a tabela inteira, com contagem EXATA. Nunca varrer os
 * registros — sao 818 mil so nas cinco tabelas da Natura QA.
 *
 * Tres janelas, porque o acumulado historico engana: "Realizar reembolso e
 * prestacao de contas" tem 39.283 no total e 1.027 nos ultimos 12 meses —
 * refatorar por total levaria ao item errado.
 */

const ITEM_TABLES = ['sc_cat_item', 'sc_cat_item_producer'];

const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

function janelas(agora = new Date()) {
  const m12 = new Date(agora); m12.setMonth(m12.getMonth() - 12);
  const d90 = new Date(agora); d90.setDate(d90.getDate() - 90);
  return [
    ['total', ''],
    ['last_12m', `sys_created_on>=${iso(m12)}`],
    ['last_90d', `sys_created_on>=${iso(d90)}`],
  ];
}

/**
 * Campo da tabela destino que referencia o item. ARMADILHA JA CONHECIDA: pode
 * estar numa tabela PAI — em `x_nasm_rtr_case` ele nao existe, esta em
 * `task.x_nasm_hr_item`. Procurar so em `name=<tabela>` devolve vazio e o
 * codigo segue reportando zero. Ver a regra de heranca no CLAUDE.md.
 */
export async function findItemField(api, table) {
  const { tableHierarchy } = await import('./collect.js');
  const chain = await tableHierarchy(api, table);
  const rows = await api.queryAll('sys_dictionary', {
    query: `nameIN${chain.join(',')}^internal_type=reference^referenceIN${ITEM_TABLES.join(',')}`,
    fields: ['name', 'element'],
    displayValue: 'false',
  });
  const ranked = rows
    .map((r) => ({ element: v(r.element), depth: chain.indexOf(v(r.name)) }))
    .filter((r) => r.depth >= 0)
    .sort((a, b) => a.depth - b.depth);
  if (!ranked.length) return null;

  // Mais de um candidato acontece (x_nasm_hr_case tem `item` proprio e
  // `x_nasm_hr_item` herdado). Fica o que estiver de fato preenchido; empate
  // vai para o mais especifico, que e o primeiro da ordenacao por profundidade.
  let escolhido = ranked[0].element;
  let melhor = -1;
  for (const c of ranked.slice(0, 3)) {
    const n = await api.count(table, `${c.element}ISNOTEMPTY`).catch(() => 0);
    if (n > melhor) { melhor = n; escolhido = c.element; }
  }
  return escolhido;
}

/**
 * @returns {Promise<Map<string, object>>} sys_id do item -> contagens
 */
export async function collectVolume(api, items, log = () => {}) {
  const agora = new Date();
  const medidoEm = iso(agora);
  const porItem = new Map();
  const fora = new Map();

  const alvo = (mapa, id, origem, campo) => {
    if (!mapa.has(id)) {
      mapa.set(id, { total: 0, last_12m: 0, last_90d: 0, source_table: origem, source_field: campo });
    }
    return mapa.get(id);
  };

  const idsMapeados = new Set(items.map((i) => v(i.sys_id)));

  // --- record producers: contam na tabela destino --------------------------
  const tabelas = [...new Set(items.map((i) => v(i.table_name)).filter(Boolean))];
  for (const table of tabelas) {
    const campo = await findItemField(api, table);
    if (!campo) {
      log(`AVISO  ${table}: nenhum campo de volta para o catalogo — sem volume para os itens desta tabela`);
      continue;
    }
    for (const [nome, filtro] of janelas(agora)) {
      const g = await api.groupCount(table, campo, filtro);
      for (const [id, n] of g) {
        if (!id) continue;
        alvo(idsMapeados.has(id) ? porItem : fora, id, table, campo)[nome] += n;
      }
    }
    log(`${table}: volume por ${campo}`);
  }

  // --- catalog item comum: conta pelos RITMs -------------------------------
  const semTabela = items.filter((i) => !v(i.table_name)).map((i) => v(i.sys_id));
  if (semTabela.length) {
    const tamanho = api.maxIdsPerQuery('sc_req_item', { queryOverhead: 60 });
    for (let i = 0; i < semTabela.length; i += tamanho) {
      const lote = semTabela.slice(i, i + tamanho);
      for (const [nome, filtro] of janelas(agora)) {
        const q = [`cat_itemIN${lote.join(',')}`, filtro].filter(Boolean).join('^');
        for (const [id, n] of await api.groupCount('sc_req_item', 'cat_item', q)) {
          if (id) alvo(porItem, id, 'sc_req_item', 'cat_item')[nome] += n;
        }
      }
    }
    log(`catalog items sem table_name: volume por sc_req_item.cat_item`);
  }

  // Item mapeado sem nenhum chamado tem que sair com zero explicito — some do
  // agrupamento, e ausencia de chave seria lida como "nao medido".
  for (const it of items) {
    const id = v(it.sys_id);
    if (!porItem.has(id)) {
      porItem.set(id, {
        total: 0, last_12m: 0, last_90d: 0,
        source_table: v(it.table_name) || 'sc_req_item',
        source_field: v(it.table_name) ? '' : 'cat_item',
      });
    }
  }

  // Ranking pelo total, calculado uma vez aqui para nao obrigar quem le o JSON
  // a ordenar 248 itens na mao.
  const ordenado = [...porItem].sort((a, b) => b[1].total - a[1].total);
  ordenado.forEach(([, c], i) => { c.rank = i + 1; });
  const soma = ordenado.reduce((n, [, c]) => n + c.total, 0);

  const saida = new Map();
  for (const [id, c] of porItem) {
    saida.set(id, {
      total: String(c.total),
      last_12m: String(c.last_12m),
      last_90d: String(c.last_90d),
      rank: String(c.rank),
      share_pct: soma ? (c.total / soma * 100).toFixed(2) : '0.00',
      source_table: c.source_table,
      source_field: c.source_field,
      measured_at: medidoEm,
    });
  }

  log(`volume: ${soma.toLocaleString('pt-BR')} chamado(s) em ${ordenado.filter(([, c]) => c.total).length} de ${items.length} itens`);

  return { byItem: saida, totalChamados: soma, foraDoRecorte: fora, measuredAt: medidoEm };
}
