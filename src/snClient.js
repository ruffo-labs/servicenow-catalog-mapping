import { getConfig } from './config.js';

/**
 * Camada HTTP para a Table API do ServiceNow.
 *
 * ⛔ SOMENTE LEITURA. Ver DIRETRIZ #1 no CLAUDE.md.
 * Só GET e HEAD saem daqui. Não há flag, env var ou parâmetro que libere
 * escrita: isso é intencional. Se um dia for preciso escrever, é outro
 * projeto, com outro cliente.
 */
const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD']);

export class ReadOnlyViolationError extends Error {
  constructor(method) {
    super(
      `Bloqueado pela diretriz read-only: método "${method}" não é permitido. ` +
      `Este agente só faz ${ALLOWED_METHODS.join('/')}. Alterações na instância ` +
      `são responsabilidade de outro agente.`
    );
    this.name = 'ReadOnlyViolationError';
  }
}

export class ServiceNowError extends Error {
  constructor(status, body, url) {
    const detail = body?.error?.message || body?.error?.detail || (typeof body === 'string' ? body : '');
    super(`ServiceNow ${status} em ${url}${detail ? `: ${detail}` : ''}`);
    this.name = 'ServiceNowError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ServiceNowClient {
  #token = null;
  #tokenExpiresAt = 0;

  constructor(config = getConfig()) {
    this.config = config;
    /** Diagnostico: quantas chamadas HTTP a instancia recebeu nesta execucao. */
    this.requestCount = 0;
  }

  async #authHeader() {
    const { authType, username, password } = this.config;
    if (authType === 'basic') {
      return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    if (Date.now() < this.#tokenExpiresAt - 30_000 && this.#token) {
      return `Bearer ${this.#token}`;
    }
    const { instanceUrl, clientId, clientSecret } = this.config;
    // O token endpoint é o único POST do projeto e não toca em nenhum registro.
    const res = await fetch(`${instanceUrl}/oauth_token.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ServiceNowError(res.status, body, '/oauth_token.do');
    this.#token = body.access_token;
    this.#tokenExpiresAt = Date.now() + (body.expires_in ?? 1800) * 1000;
    return `Bearer ${this.#token}`;
  }

  /**
   * @param {string} path  ex: '/api/now/table/sc_cat_item'
   * @param {{ query?: Record<string, string|number|boolean|undefined>, method?: string }} opts
   * @returns {Promise<{ result: any, headers: Headers }>}
   */
  async request(path, { query = {}, method = 'GET' } = {}) {
    const verb = String(method).toUpperCase();
    if (!ALLOWED_METHODS.includes(verb)) throw new ReadOnlyViolationError(verb);

    const url = new URL(this.config.instanceUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const headers = {
      Accept: 'application/json',
      Authorization: await this.#authHeader(),
    };

    let lastError;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      this.requestCount++;
      try {
        const res = await fetch(url, {
          method: verb,
          headers,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
          const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(2 ** attempt * 1000, 30_000) + Math.random() * 500;
          lastError = new ServiceNowError(res.status, await res.text().catch(() => ''), url.pathname);
          if (attempt < this.config.maxRetries) {
            await sleep(waitMs);
            continue;
          }
          throw lastError;
        }

        const text = await res.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          // ACL negada ou sessão inválida costuma devolver HTML de login
          throw new ServiceNowError(res.status, text.slice(0, 300), url.pathname);
        }
        if (!res.ok) throw new ServiceNowError(res.status, body, url.pathname);
        return { result: body.result, headers: res.headers };
      } catch (err) {
        if (err instanceof ServiceNowError || err instanceof ReadOnlyViolationError) throw err;
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await sleep(Math.min(2 ** attempt * 1000, 15_000));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  }
}

export { ALLOWED_METHODS };
