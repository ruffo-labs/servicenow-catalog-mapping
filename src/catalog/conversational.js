/**
 * Avalia se um item de catalogo esta pronto para ser pedido pela IA da
 * ServiceNow (Virtual Agent / Now Assist em Conversational Catalog).
 *
 * ATENCAO AO GRAU DE CONFIANCA. Isto NAO e um campo da instancia — os campos
 * da instancia (`make_item_non_conversational`, `turn_off_nowassist_conversation`)
 * existem, saem no JSON, e na Natura QA estao vazios em 759 de 759 itens.
 * Ninguem configurou conversacional ainda, entao o campo sozinho nao responde
 * nada. Esta avaliacao aplica os criterios publicados pela ServiceNow ao que
 * ja foi extraido. E indicacao de onde olhar, nao certificado de que roda.
 *
 * Fonte dos criterios (consultada em 2026-09-23):
 * - Now Assist in Conversational Catalog Request: Guidance for making catalog
 *   items conversational (ServiceNow Community, ta-p/2987560) — tipos
 *   suportados e tabela de limitacoes
 * - Gotchas and Leading Implementation Practices for Conversational Catalog
 *   (ServiceNow Community, ta-p/3239644) — UI policies onLoad, rotulos
 *
 * Os NUMEROS de `type` vem do `sys_choice` da tabela `question` DESTA
 * instancia (ver scripts/test-connection.js). Nao sao chutados de memoria:
 * nesta instancia 20 e Container End e 21 e List Collector, nao o contrario.
 */

/** Tipos que a documentacao trata como nao renderizaveis em conversa. */
const TIPO_BLOQUEIA = new Map([
  ['14', 'Custom (tipo personalizado)'],
  ['17', 'Custom with Label (personalizado com rotulo)'],
  ['23', 'HTML'],
  ['25', 'Masked'],
  ['27', 'URL'],
]);

/** Tipos suportados, porem com limitacao documentada. */
const TIPO_RESSALVA = new Map([
  ['21', 'List Collector: quebra se as opcoes vierem de filtro dinamico ou client script'],
  ['22', 'Lookup Multiple Choice: o usuario nao consegue pular a pergunta'],
  ['31', 'Requested For: o usuario nao consegue pular a pergunta'],
  ['32', 'Rich Text Label: a midia e removida, so a URL sobrevive'],
  ['33', 'Attachment: anexo exige tratamento a parte na conversa'],
  ['29', 'Duration'],
  ['40', 'Table Name'],
]);

/** Classes de item que a documentacao exclui de conversa. */
const CLASSE_BLOQUEIA = new Map([
  ['sc_cat_item_content', 'Content Item nao e suportado em conversa'],
  ['sc_cat_item_order_guide', 'Order Guide nao e suportado em conversa'],
  ['sc_cat_item_wizard', 'Wizard Launcher nao e suportado em conversa'],
]);

/**
 * Limite de perguntas renderizadas inline, da propriedade
 * `glide.sc.va.inline_render.question.limit` — 20 nesta instancia. Acima
 * disso a VA abre janela em vez de responder na conversa.
 */
const LIMITE_INLINE = 20;

const texto = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.__text ?? '' : '');
const vazio = (x) => !texto(x);

/**
 * @param {object} item        item ja no formato do contrato
 * @param {object[]} variaveis variaveis do item + as dos variable sets que ele usa
 * @param {object[]} scripts   catalog client scripts do item e dos sets
 * @param {object[]} policies  catalog UI policies do item e dos sets
 */
export function assessConversational(item, variaveis, scripts, policies) {
  const bloqueadores = [];
  const avisos = [];
  const add = (lista, code, detail, onde) => lista.push(onde ? { code, detail, onde } : { code, detail });

  // --- o que a propria instancia declara -----------------------------------
  const desligadoVA = texto(item.make_item_non_conversational) === 'true';
  const desligadoNowAssist = texto(item.turn_off_nowassist_conversation) === 'true';
  if (desligadoVA) {
    add(bloqueadores, 'flag_instancia', 'o item esta marcado como "Make the item non-conversational in VA"');
  }
  if (desligadoNowAssist) {
    add(avisos, 'flag_instancia', 'Now Assist (LLM) desligado neste item (`turn_off_nowassist_conversation`)');
  }

  const classe = texto(item.sys_class_name);
  if (CLASSE_BLOQUEIA.has(classe)) add(bloqueadores, 'classe_do_item', CLASSE_BLOQUEIA.get(classe));

  // --- variaveis ------------------------------------------------------------
  const ativas = variaveis.filter((v) => texto(v.active) !== 'false');
  const perguntas = ativas.filter((v) => !['11', '19', '20', '24', '12', '32'].includes(texto(v.type)));

  for (const v of ativas) {
    const tipo = texto(v.type);
    const rotulo = texto(v.type_label) || tipo;
    const nome = texto(v.name) || texto(v.sys_name) || texto(v.sys_id);

    if (TIPO_BLOQUEIA.has(tipo)) {
      // Topic Block e a saida oficial para tipo personalizado em VA.
      if (!vazio(v.topic_block)) {
        add(avisos, 'tipo_personalizado_com_topic_block',
          `${TIPO_BLOQUEIA.get(tipo)} — tem Topic Block, o que destrava, mas exige o bloco testado`, nome);
      } else {
        add(bloqueadores, 'tipo_nao_suportado', `${TIPO_BLOQUEIA.get(tipo)} (type ${tipo} / ${rotulo})`, nome);
      }
    } else if (TIPO_RESSALVA.has(tipo)) {
      add(avisos, 'tipo_com_limitacao', TIPO_RESSALVA.get(tipo), nome);
    }

    if (!vazio(v.macro)) add(bloqueadores, 'macro', 'variavel usa UI Macro, que nao renderiza em conversa', nome);
    if (!vazio(v.sp_widget)) add(bloqueadores, 'widget', 'variavel usa widget de portal, que nao renderiza em conversa', nome);
    if (texto(v.not_available_conversation) === 'true') {
      add(avisos, 'variavel_fora_da_conversa', 'variavel marcada como "Remove from Conversational Interfaces"', nome);
    }
    if (texto(v.reference_qual_condition) || texto(v.reference_qual)) {
      add(avisos, 'reference_qualifier', 'reference qualifier avancado/dinamico: a doc avisa que pode nao resolver em conversa', nome);
    }
    // Sim/Nao precisa de "Include None" para o usuario conseguir responder.
    if (tipo === '1' && texto(v.include_none) !== 'true') {
      add(avisos, 'sim_nao_sem_include_none', 'Sim/Nao sem "Include None" marcado', nome);
    }
    if (texto(v.mandatory) === 'true' && ['19', '24'].includes(tipo)) {
      add(avisos, 'container_obrigatorio', 'a doc pede para nao marcar container como obrigatorio', nome);
    }
  }

  const semRotulo = perguntas.filter((v) => vazio(v.conversational_label)).length;
  if (semRotulo) {
    add(avisos, 'sem_conversational_label',
      `${semRotulo} de ${perguntas.length} pergunta(s) sem "Conversational label" — a VA vai ler o texto da pergunta do formulario`);
  }

  if (perguntas.length > LIMITE_INLINE) {
    add(avisos, 'muitas_perguntas',
      `${perguntas.length} perguntas; acima de ${LIMITE_INLINE} (glide.sc.va.inline_render.question.limit) a VA abre janela em vez de conversar`);
  }

  // --- scripts e policies ---------------------------------------------------
  const scriptsNaoVA = scripts.filter((s) => texto(s.active) !== 'false' && texto(s.va_supported) !== 'true');
  if (scriptsNaoVA.length) {
    add(bloqueadores, 'client_script_sem_va',
      `${scriptsNaoVA.length} catalog client script(s) ativo(s) sem "VA Supported": ${scriptsNaoVA.slice(0, 5).map((s) => texto(s.name)).join(', ')}${scriptsNaoVA.length > 5 ? '...' : ''}`);
  }
  const policiesNaoVA = policies.filter((p) => texto(p.active) !== 'false' && texto(p.va_supported) !== 'true');
  if (policiesNaoVA.length) {
    add(bloqueadores, 'ui_policy_sem_va', `${policiesNaoVA.length} UI policy(ies) ativa(s) sem "VA Supported"`);
  }
  const onLoad = policies.filter((p) => texto(p.active) !== 'false' && texto(p.on_load) === 'true');
  if (onLoad.length) {
    add(avisos, 'ui_policy_on_load',
      `${onLoad.length} UI policy(ies) com "On load": a doc pede definir o atributo direto na pergunta em vez de policy onLoad`);
  }

  const veredito = bloqueadores.length ? 'bloqueado' : avisos.length ? 'com_ressalvas' : 'apto';

  return {
    veredito,
    // Repetido aqui de proposito: e o unico dado que vem da instancia, o resto
    // e avaliacao. Quem ler o bloco tem que conseguir separar os dois.
    declarado_na_instancia: {
      make_item_non_conversational: desligadoVA ? 'true' : 'false',
      turn_off_nowassist_conversation: desligadoNowAssist ? 'true' : 'false',
      configurado_por_alguem: desligadoVA || desligadoNowAssist ? 'true' : 'false',
    },
    resumo: {
      perguntas: String(perguntas.length),
      variaveis_ativas: String(ativas.length),
      bloqueadores: String(bloqueadores.length),
      avisos: String(avisos.length),
      perguntas_sem_conversational_label: String(semRotulo),
    },
    bloqueadores,
    avisos,
    criterios: 'ServiceNow Community ta-p/2987560 e ta-p/3239644, consultados em 2026-09-23. Avaliacao sobre a configuracao extraida — nao substitui teste no Virtual Agent.',
  };
}
