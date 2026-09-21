import { ServiceNowClient } from './snClient.js';

/** Helpers de leitura sobre a Table API. Tudo aqui é GET. */
export class TableApi {
  constructor(client = new ServiceNowClient()) {
    this.client = client;
  }

  /**
   * Uma página de registros.
   * @param {string} table
   * @param {object} opts
   * @param {string} [opts.query]        encoded query (sysparm_query)
   * @param {string[]} [opts.fields]     colunas desejadas
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   * @param {'true'|'false'|'all'} [opts.displayValue]  'all' traz value + display_value
   */
  async query(table, {
    query,
    fields,
    limit = this.client.config.pageSize,
    offset = 0,
    displayValue = 'all',
    excludeReferenceLink = true,
  } = {}) {
    const { result, headers } = await this.client.request(`/api/now/table/${table}`, {
      query: {
        sysparm_query: query,
        sysparm_fields: fields?.length ? fields.join(',') : undefined,
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: displayValue,
        sysparm_exclude_reference_link: excludeReferenceLink,
      },
    });
    return { records: result ?? [], totalCount: Number(headers.get('x-total-count') ?? NaN) };
  }

  /**
   * Todos os registros, paginando por keyset (sys_id) em vez de offset.
   * Offset profundo no ServiceNow degrada muito; keyset mantém custo constante.
   * Requer que `query` não traga ORDERBY próprio: ele é substituído.
   */
  async *iterate(table, { query = '', fields, pageSize, ...rest } = {}) {
    const size = pageSize ?? this.client.config.pageSize;
    const base = stripOrderBy(query);

    // ARMADILHA: com `^NQ` a encoded query vira grupos independentes, e o
    // `^sys_id>cursor` gruda SO no ultimo grupo: os anteriores nunca avancam e
    // a paginacao por keyset entra em loop infinito. Nesse caso, offset.
    if (/\^NQ/i.test(base) || /^NQ/i.test(base)) {
      yield* this.#iterateByOffset(table, { query: base, fields, size, ...rest });
      return;
    }

    let cursor = null;
    const seen = new Set();

    for (;;) {
      const parts = [];
      if (base) parts.push(base);
      if (cursor) parts.push(`sys_id>${cursor}`);
      const q = `${parts.join('^')}^ORDERBYsys_id`;

      const { records } = await this.query(table, {
        ...rest,
        query: q,
        // sys_id é obrigatório para o cursor funcionar
        fields: fields?.length ? [...new Set([...fields, 'sys_id'])] : undefined,
        limit: size,
        offset: 0,
      });

      if (records.length === 0) return;
      for (const r of records) yield r;
      if (records.length < size) return;

      const next = rawValue(records.at(-1).sys_id);
      // Trava: se o cursor nao avancou, e loop. Melhor estourar do que martelar
      // a instancia para sempre.
      if (seen.has(next)) {
        throw new Error(
          `Paginacao travada em ${table}: o cursor parou em ${next}. ` +
          `Query provavelmente incompativel com keyset: reporte com a query usada.`,
        );
      }
      seen.add(next);
      cursor = next;
    }
  }

  /** Paginacao por offset: usada quando a query tem `^NQ`. Mais cara, mas correta. */
  async *#iterateByOffset(table, { query, fields, size, ...rest }) {
    for (let offset = 0; ; offset += size) {
      const { records } = await this.query(table, { ...rest, query, fields, limit: size, offset });
      if (records.length === 0) return;
      for (const r of records) yield r;
      if (records.length < size) return;
    }
  }

  /** Coleta tudo em array. Cuidado com volumes grandes. */
  async queryAll(table, opts = {}) {
    const out = [];
    for await (const r of this.iterate(table, opts)) out.push(r);
    return out;
  }

  /** Um registro por sys_id. Retorna null se não existir ou se a ACL negar. */
  async getRecord(table, sysId, { fields, displayValue = 'all' } = {}) {
    try {
      const { result } = await this.client.request(`/api/now/table/${table}/${sysId}`, {
        query: {
          sysparm_fields: fields?.length ? fields.join(',') : undefined,
          sysparm_display_value: displayValue,
          sysparm_exclude_reference_link: true,
        },
      });
      return result ?? null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /** Contagem via Aggregate API: bem mais barato que puxar os registros. */
  async count(table, query = '') {
    const { result } = await this.client.request(`/api/now/stats/${table}`, {
      query: { sysparm_query: query, sysparm_count: true },
    });
    return Number(result?.stats?.count ?? 0);
  }

  /**
   * Quantos sys_id cabem num `<campo>IN<...>` sem estourar o limite de URL.
   *
   * ARMADILHA: acima de ~2048 chars o ServiceNow devolve 400 com a mensagem
   * "Pagination not supported", que nao tem relacao com a causa. Um CHUNK fixo
   * quebra quando a lista de campos cresce: por isso o calculo e dinamico.
   */
  maxIdsPerQuery(table, { fields = [], queryOverhead = 0 } = {}) {
    const SAFE_URL = 1800;
    const base = this.client.config.instanceUrl.length + `/api/now/table/${table}`.length;
    const fixedParams = 140;           // limit, offset, display_value, exclude_reference_link
    const cursor = 45;                 // "^sys_id><32 chars>^ORDERBYsys_id"
    const fieldsLen = fields.length ? fields.join(',').length + 16 : 0;
    const budget = SAFE_URL - base - fixedParams - cursor - fieldsLen - queryOverhead;
    return Math.max(1, Math.floor(budget / 33)); // 32 chars do sys_id + virgula
  }

  /**
   * Contagem agrupada via Aggregate API: uma chamada resolve o que seria uma
   * varredura. Ex.: execucoes por nome de flow numa tabela.
   */
  async groupCount(table, groupBy, query = '') {
    const { result } = await this.client.request(`/api/now/stats/${table}`, {
      query: { sysparm_count: true, sysparm_group_by: groupBy, sysparm_query: query },
    });
    return new Map((result ?? []).map((r) => [
      r.groupby_fields?.[0]?.value ?? '',
      Number(r.stats?.count ?? 0),
    ]));
  }

  /** Choices de um campo (ex.: o mapa numérico de item_option_new.type). */
  async getFieldChoices(table, element) {
    const rows = await this.queryAll('sys_choice', {
      query: `name=${table}^element=${element}^inactive=false^language=en`,
      fields: ['value', 'label', 'sequence'],
      displayValue: 'false',
    });
    return Object.fromEntries(rows.map((r) => [rawValue(r.value), rawValue(r.label)]));
  }

  /** Dicionário de uma tabela: útil para saber o que existe nesta versão da instância. */
  async getDictionary(table) {
    return this.queryAll('sys_dictionary', {
      query: `name=${table}^ORDERBYelement`,
      fields: ['element', 'column_label', 'internal_type', 'reference', 'mandatory', 'max_length'],
    });
  }

  /** true se a coluna existir na instância: evita quebrar por diferença de versão. */
  async hasField(table, element) {
    return (await this.count('sys_dictionary', `name=${table}^element=${element}`)) > 0;
  }
}

/** Com sysparm_display_value=all cada campo vira {value, display_value}. */
export function rawValue(field) {
  if (field && typeof field === 'object' && 'value' in field) return field.value;
  return field ?? '';
}

export function displayValue(field) {
  if (field && typeof field === 'object' && 'display_value' in field) return field.display_value;
  return field ?? '';
}

/** Referência vira {sys_id, display} ou null. */
export function refValue(field) {
  const value = rawValue(field);
  if (!value) return null;
  return { sys_id: value, display: displayValue(field) || null };
}

function stripOrderBy(query) {
  return query
    .split('^')
    .filter((c) => !/^ORDERBY(DESC)?/i.test(c))
    .join('^');
}
