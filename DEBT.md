# DEBT

Dívida técnica consciente. Todo atalho aceito fica aqui, com data, motivo e
plano de pagamento. Nada de marcador de pendência solto no código: o lint
bloqueia.

---

## D-001: Infisical não adotado, segredo em `.env`

- **Data:** 2026-09-21
- **O que é:** o padrão de harness manda cofre único (Infisical), com o deploy
  injetando variáveis e negando leitura e escrita de `.env` reais. Este projeto
  lê credencial de instância ServiceNow de um `.env` local.
- **Por que foi aceito:** decisão do dono do projeto. O projeto é uma CLI de
  leitura, roda na máquina do operador e não tem deploy. Migrar agora atrasaria
  o fechamento do harness sem reduzir risco imediato.
- **Risco real:** a credencial fica em texto plano no disco do operador. O
  `.env` está no `.gitignore` e foi auditado: nunca entrou no repositório nem no
  histórico.
- **Plano de pagamento:** se o projeto passar a rodar em CI, servidor ou
  agendador, migrar para Infisical antes disso. Enquanto for execução local
  manual, permanece.

## D-002: Sem typecheck, só checagem de sintaxe

- **Data:** 2026-09-21
- **O que é:** o padrão pede `verify` com typecheck. O `verify` hoje roda
  `node --check` em todos os arquivos, que pega erro de sintaxe mas não de tipo.
- **Por que foi aceito:** adotar `tsc --checkJs` exige `typescript` como
  devDependency, e o projeto tem decisão documentada de zero dependências
  (`SPEC.md`, seção 8). A decisão vale a pena revisitar, mas não no PR do
  harness.
- **Risco real:** baixo. O código é pequeno, tem JSDoc em boa parte, e os erros
  que mais machucaram neste projeto (herança de tabela, limite de URL, `^NQ`)
  não seriam pegos por typecheck de qualquer forma.
- **Plano de pagamento:** decidir com o dono se vale abrir exceção à regra de
  zero dependências para ferramentas de desenvolvimento. Se sim, adicionar
  `typescript` em `devDependencies` e trocar `check:syntax` por
  `tsc --checkJs --noEmit`.

## D-003: Travessão ainda presente na documentação

- **Data:** 2026-09-21
- **O que é:** o lint proíbe travessão, mas hoje roda só sobre `.js`. Restam
  cerca de 175 ocorrências nos arquivos `.md`.
- **Por que foi aceito:** limpar 10 arquivos de documentação no mesmo PR que
  cria a camada de verificação tornaria o diff difícil de revisar.
- **Risco real:** nenhum funcional, é convenção de escrita.
- **Plano de pagamento:** PR seguinte (`claude/f0-pr2-docs`): limpar os `.md` e
  passar o `lint` a rodar com `--docs` dentro do `verify`.

## D-004: Sem branch protection na `main`

- **Data:** 2026-09-21
- **O que é:** a `main` aceita push direto. O commit `6a3fab7` foi feito assim,
  antes do harness existir.
- **Por que foi aceito:** o repositório nasceu antes do harness ser adotado.
- **Risco real:** o fluxo da seção 6 do padrão depende de disciplina, não de
  mecanismo.
- **Plano de pagamento:** o dono do projeto habilita branch protection no
  GitHub exigindo PR e o check `verify` verde. Depende de acesso de admin ao
  repositório, então está listado como pendência no `HANDOFF.md`.

## D-005: `gh` não instalado, PR é manual

- **Data:** 2026-09-21
- **O que é:** o padrão prevê `gh pr create` na allowlist. O `gh` não está
  instalado nesta máquina.
- **Por que foi aceito:** não bloqueia o trabalho, só exige abrir o PR pelo
  navegador.
- **Plano de pagamento:** instalar o `gh` e autenticar. Depois disso, liberar
  `gh pr create` na allowlist (e manter `gh pr merge` pedindo confirmação).

## D-006: `.env.example` com ponto na frente

- **Data:** 2026-09-21
- **O que é:** o padrão define o nome `env.example`, sem ponto. O projeto usa
  `.env.example`.
- **Por que foi aceito:** renomear agora quebraria o `README.md`, o `SPEC.md` e
  o `docs/runbook.md`, que já referenciam o nome atual.
- **Plano de pagamento:** renomear no PR de documentação (`claude/f0-pr2-docs`),
  junto com a atualização das referências.
