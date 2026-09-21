import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { ServiceNowClient, ReadOnlyViolationError, ALLOWED_METHODS } from '../src/snClient.js';

/**
 * DIRETRIZ #1: o agente nunca escreve na instancia.
 *
 * Esta e a regra inviolavel do dominio. Estes testes bloqueiam o merge se
 * alguem afrouxar o guard, e rodam sem rede: a config e falsa e nenhuma
 * requisicao chega a sair, porque o metodo e recusado antes do fetch.
 */

const fakeConfig = {
  instanceUrl: 'https://exemplo.service-now.com',
  authType: 'basic',
  username: 'u',
  password: 'p',
  pageSize: 100,
  timeoutMs: 1000,
  maxRetries: 0,
};

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'put', 'patch', 'delete'];

test('a allowlist tem apenas GET e HEAD', () => {
  assert.deepEqual([...ALLOWED_METHODS].sort(), ['GET', 'HEAD']);
});

test('a allowlist e imutavel (nao da para injetar um metodo de escrita)', () => {
  assert.ok(Object.isFrozen(ALLOWED_METHODS), 'ALLOWED_METHODS precisa estar congelada');
  assert.throws(() => ALLOWED_METHODS.push('POST'), 'push numa lista congelada deve falhar');
  assert.equal(ALLOWED_METHODS.length, 2, 'a lista nao pode crescer');
});

for (const method of WRITE_METHODS) {
  test(`${method} e bloqueado antes de sair a requisicao`, async () => {
    const client = new ServiceNowClient(fakeConfig);
    await assert.rejects(
      () => client.request('/api/now/table/incident', { method }),
      ReadOnlyViolationError,
      `${method} deveria lancar ReadOnlyViolationError`,
    );
    assert.equal(client.requestCount, 0, 'nenhuma chamada pode ter sido contada');
  });
}

test('o bloqueio acontece antes de qualquer acesso a rede', async () => {
  // Host inexistente: se o guard falhasse, o fetch tentaria resolver o DNS e o
  // erro seria de rede, nao de politica.
  const client = new ServiceNowClient({ ...fakeConfig, instanceUrl: 'https://nao-existe.invalid' });
  await assert.rejects(
    () => client.request('/api/now/table/incident', { method: 'POST' }),
    (err) => err instanceof ReadOnlyViolationError,
    'o erro precisa ser de politica, nao de rede',
  );
});

test('a mensagem de erro aponta para o outro agente', async () => {
  const client = new ServiceNowClient(fakeConfig);
  await assert.rejects(
    () => client.request('/api/now/table/incident', { method: 'DELETE' }),
    (err) => /outro agente/i.test(err.message),
  );
});

test('o codigo do cliente HTTP nao contem metodo de escrita fora do OAuth', () => {
  const source = readFileSync(new URL('../src/snClient.js', import.meta.url), 'utf8');

  // A unica excecao consciente e o token endpoint do OAuth, que nao toca em
  // registro. Ver DIRETRIZ #1 no CLAUDE.md.
  const withoutOAuth = source.replace(/const res = await fetch\(`\$\{instanceUrl\}\/oauth_token\.do`[\s\S]*?\}\);/, '');

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(
      !new RegExp(`method:\\s*['"\`]${method}`, 'i').test(withoutOAuth),
      `snClient.js nao pode declarar method: '${method}' fora do fluxo OAuth`,
    );
  }
});
