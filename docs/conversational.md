# Conversacional: o item dá para ser pedido pela IA?

Avalia se um item de catálogo está pronto para ser pedido por conversa no
Virtual Agent / Now Assist (Conversational Catalog). Sai em cada item, no bloco
`conversational`.

Módulo: `src/catalog/conversational.js` · custa **zero** chamada extra — usa o
que a fase 1 já extraiu.

---

## ⚠ Antes de tudo: o grau de confiança

Isto **não é um campo da instância**. Os campos existem e saem no JSON:

| Tabela | Campo | Rótulo na instância |
|---|---|---|
| `sc_cat_item` | `make_item_non_conversational` | Make the item non-conversational in VA |
| `sc_cat_item` | `turn_off_nowassist_conversation` | Turn off Now Assist(LLM) |
| `sc_cat_item` | `taxonomy_topic` | Taxonomy topic |
| `item_option_new` | `conversational_label` | Conversational label |
| `item_option_new` | `not_available_conversation` | Remove from Conversational Interfaces |
| `item_option_new` | `topic_block` | Topic block |

**Na `instancenaturasnqa` esses campos estão vazios.** Zero itens marcados nos
759 do catálogo, 9 `conversational_label` preenchidos na instância inteira e
nenhum `topic_block`. Ninguém configurou conversacional ali ainda — então ler
só o campo não responde nada, e por isso existe a avaliação.

O bloco separa as duas coisas de propósito:

- `declarado_na_instancia` — o que está no registro. **Fato.**
- `veredito`, `bloqueadores`, `avisos` — regra aplicada por nós. **Indicação de
  onde olhar, não certificado de que roda.** Quem decide é um teste no Virtual
  Agent.

## De onde vieram os critérios

Documentação da ServiceNow consultada em 2026-09-23:

- [Now Assist in Conversational Catalog Request: Guidance for making catalog items conversational](https://www.servicenow.com/community/intelligence-ml-articles/now-assist-in-conversational-catalog-request-guidance-for-making/ta-p/2987560) — tipos suportados e a tabela de limitações
- [Gotchas and Leading Implementation Practices for Conversational Catalog and LLM Flows](https://www.servicenow.com/community/ceg-ai-coe-articles/gotchas-and-leading-practices-conv-catalog-items-and-llm-topics/ta-p/3239644) — UI policies onLoad, rótulos, minimizar variáveis

Os **números** de `type` não vêm dessas páginas nem da memória do modelo: vêm
do `sys_choice` da tabela `question` **desta** instância. Nesta instância `20`
é Container End e `21` é List Collector — já erramos isso antes.

## O veredito

| Valor | Quando |
|---|---|
| `apto` | nenhum bloqueador e nenhum aviso |
| `com_ressalvas` | só avisos — provavelmente funciona, com degradação |
| `bloqueado` | pelo menos um bloqueador |

## Bloqueadores

| `code` | Motivo |
|---|---|
| `flag_instancia` | `make_item_non_conversational = true` no próprio registro |
| `classe_do_item` | Content Item, Order Guide ou Wizard — a doc exclui |
| `tipo_nao_suportado` | variável do tipo Custom (14), Custom with Label (17), HTML (23), Masked (25) ou URL (27) |
| `macro` | variável usa UI Macro |
| `widget` | variável usa widget de portal (`sp_widget`) |
| `client_script_sem_va` | catalog client script ativo sem **VA Supported** |
| `ui_policy_sem_va` | UI policy ativa sem **VA Supported** |

Tipo Custom **com `topic_block` preenchido** vira aviso em vez de bloqueador —
Topic Block é a saída oficial para isso.

## Avisos

| `code` | Motivo |
|---|---|
| `tipo_com_limitacao` | List Collector, Lookup Multiple Choice, Requested For, Rich Text Label, Attachment, Duration, Table Name |
| `sem_conversational_label` | perguntas sem rótulo conversacional — a VA lê o texto do formulário |
| `muitas_perguntas` | acima de 20 (`glide.sc.va.inline_render.question.limit` nesta instância) a VA abre janela em vez de conversar |
| `ui_policy_on_load` | a doc pede atributo direto na pergunta em vez de policy onLoad |
| `reference_qualifier` | qualifier avançado/dinâmico pode não resolver em conversa |
| `sim_nao_sem_include_none` | Yes/No precisa de "Include None" para o usuário conseguir responder |
| `container_obrigatorio` | a doc pede para não marcar container como mandatory |
| `variavel_fora_da_conversa` | variável com `not_available_conversation = true` |
| `flag_instancia` | `turn_off_nowassist_conversation = true` (VA ainda funciona, o LLM não) |

## O item não é só o item

A avaliação considera as variáveis, UI policies e client scripts **dos variable
sets que o item usa**, não só os dele. Um set compartilhado com um client
script sem VA Supported derruba todos os itens que o usam — e é justamente o
tipo de coisa que passa despercebido.

## Forma no JSON

```json
"conversational": {
  "veredito": "bloqueado",
  "declarado_na_instancia": {
    "make_item_non_conversational": "false",
    "turn_off_nowassist_conversation": "false",
    "configurado_por_alguem": "false"
  },
  "resumo": {
    "perguntas": "23", "variaveis_ativas": "31",
    "bloqueadores": "2", "avisos": "4",
    "perguntas_sem_conversational_label": "23"
  },
  "bloqueadores": [
    { "code": "tipo_nao_suportado", "detail": "Custom (tipo personalizado) (type 14 / Personalizado)", "onde": "anexo_comprovante" }
  ],
  "avisos": [ ... ],
  "criterios": "ServiceNow Community ta-p/2987560 e ta-p/3239644, consultados em 2026-09-23. ..."
}
```

`onde` traz o nome da variável culpada — é por ele que se acha o que consertar.

## Como manter

Os critérios são de documentação de produto, e produto muda. Quando revisar:

1. Releia as duas páginas acima e compare com `TIPO_BLOQUEIA` / `TIPO_RESSALVA`
   em `src/catalog/conversational.js`.
2. Releia o mapa de `type` da instância (`node scripts/test-connection.js`) —
   os números mudam entre instâncias e versões.
3. Confira as propriedades: `glide.sc.va.inline_render.question.limit`,
   `glide.sc.va.reference_question_choices.limit`,
   `sn_now_assist_cr.llm.conversational.request.question.limit`.
4. Rode `node scripts/selftest.js` — as regras têm teste sem rede.
