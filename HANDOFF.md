# HANDOFF

Atualizado em: 2026-09-21, por: `claude/f0-pr1-verificacao`

## Estado atual

- **Fase:** adoção do harness. O agente de mapeamento já está pronto e validado
  em produção; o que falta é a camada de processo em volta dele.
- **Último PR mergeado:** nenhum. O repositório nasceu com um commit direto na
  `main` (`6a3fab7 "New Itens"`), antes do harness.
- **PRs abertos:** nenhum. A branch `claude/f0-pr1-verificacao` está pronta e
  aguardando autorização.
- **Verify:** verde. 29 testes, sintaxe e lint ok.

## Próximo passo

Autorizar o PR 1 (camada de verificação). Depois dele, `claude/f0-pr2-docs`:
limpar os travessões da documentação e ligar o `lint --docs` no `verify`.

## Decisões recentes

- 2026-09-21: harness do padrão Next Level Tech adotado, com adaptações. Não há
  banco nem deploy, então hook de migrations não se aplica.
- 2026-09-21: Infisical fica como dívida (D-001), decisão do dono do projeto.
- 2026-09-21: `verify` construído só com Node embutido, para respeitar a decisão
  de zero dependências do projeto (`SPEC.md`, seção 8). Typecheck vira dívida
  (D-002).
- 2026-09-21: harness adotado em PRs fatiados em vez de um bootstrap único,
  porque o código do projeto já existia. O padrão prevê bootstrap num PR só para
  projetos que nascem do zero.

## Pendências do dono do projeto

- **Branch protection na `main`** exigindo PR e o check `verify` verde. Precisa
  de acesso de admin em `ruffo-labs/servicenow-catalog-mapping` (feito no
  navegador, em Settings > Branches).
- **Instalar o `gh`** e autenticar, para o fluxo de PR sair do manual (D-005).
- **Decidir sobre typecheck** (D-002): abrir exceção à regra de zero
  dependências para ferramenta de desenvolvimento, ou manter só a checagem de
  sintaxe.

## Exceções conscientes

- O único `POST` do projeto é o token endpoint do OAuth
  (`/oauth_token.do`), quando `SN_AUTH_TYPE=oauth`. Não toca em registro, está
  isolado no método de autenticação, e o teste de guard e o lint tratam essa
  exceção explicitamente.
- Nesta sessão o `.env` foi criado com credenciais a pedido do dono do projeto,
  o que o padrão proíbe. Registrado em D-001. As credenciais da instância
  `alpartecnologialtdademo3` apareceram no chat e devem ser rotacionadas se o
  transcript for compartilhado.

## Armadilhas conhecidas

Todas documentadas em `docs/table-api.md` e `docs/fulfillment.md`. As que mais
custaram:

- **Herança de tabela no `sys_dictionary`.** Consultar `name=<tabela>` sozinho
  faz a busca voltar vazia e o código seguir. Causou três bugs, um deles
  reportando zero execuções onde havia 92.540 registros.
- **`^NQ` quebra a paginação por keyset.** Loop infinito martelando a instância.
  Há trava anti-loop, mas a query cai para offset.
- **Limite de URL de cerca de 2048 chars.** O ServiceNow responde 400 com
  mensagem enganosa (`Pagination not supported`).
- **ACL filtra em silêncio.** Contagem baixa é permissão, não filtro.
