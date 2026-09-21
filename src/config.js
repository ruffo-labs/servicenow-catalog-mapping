import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carrega .env sem dependência externa. Não sobrescreve o que já veio do ambiente. */
function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let cached;

export function getConfig() {
  if (cached) return cached;
  loadDotEnv();

  const instanceUrl = (process.env.SN_INSTANCE_URL || '').replace(/\/+$/, '');
  if (!instanceUrl) {
    throw new Error('SN_INSTANCE_URL não definida. Copie .env.example para .env e preencha.');
  }
  if (!/^https:\/\//i.test(instanceUrl)) {
    throw new Error('SN_INSTANCE_URL precisa usar https.');
  }

  const authType = (process.env.SN_AUTH_TYPE || 'basic').toLowerCase();
  if (!['basic', 'oauth'].includes(authType)) {
    throw new Error(`SN_AUTH_TYPE inválido: ${authType}. Use "basic" ou "oauth".`);
  }
  if (authType === 'basic' && !(process.env.SN_USERNAME && process.env.SN_PASSWORD)) {
    throw new Error('SN_AUTH_TYPE=basic exige SN_USERNAME e SN_PASSWORD no .env.');
  }
  if (authType === 'oauth' && !(process.env.SN_CLIENT_ID && process.env.SN_CLIENT_SECRET)) {
    throw new Error('SN_AUTH_TYPE=oauth exige SN_CLIENT_ID e SN_CLIENT_SECRET no .env.');
  }

  const int = (name, fallback) => {
    const v = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  cached = {
    instanceUrl,
    authType,
    username: process.env.SN_USERNAME,
    password: process.env.SN_PASSWORD,
    clientId: process.env.SN_CLIENT_ID,
    clientSecret: process.env.SN_CLIENT_SECRET,
    pageSize: Math.min(int('SN_PAGE_SIZE', 200), 1000),
    timeoutMs: int('SN_TIMEOUT_MS', 60_000),
    maxRetries: int('SN_MAX_RETRIES', 4),
  };
  return cached;
}
