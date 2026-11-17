/** Listas de campos por tabela. Validadas contra sys_dictionary antes do uso. */

export const ITEM_FIELDS = [
  'active', 'category', 'description', 'name', 'order', 'sc_catalogs',
  'short_description', 'state', 'sys_class_name', 'sys_id', 'sys_name', 'type',
  'flow_designer_flow', 'workflow',
  // Conversacional (Virtual Agent / Now Assist). Existem na instancia e estao
  // VAZIOS em todos os 759 itens da Natura QA — o valor esta na avaliacao
  // (src/catalog/conversational.js), nao no campo em si.
  'make_item_non_conversational', 'turn_off_nowassist_conversation', 'taxonomy_topic',
];

/** Só existem na classe filha — exigem consulta separada em sc_cat_item_producer. */
export const PRODUCER_FIELDS = [
  'sys_id', 'table_name', 'redirect_url', 'view',
  'script', 'post_insert_script', 'save_script',
];

export const VARIABLE_FIELDS = [
  'active', 'cat_item',
  // Origem das opcoes quando NAO vem de question_choice: Select Box que puxa do
  // dicionario da tabela destino (choice_*) ou Lookup que consulta outra tabela (lookup_*).
  'choice_direction', 'choice_field', 'choice_table', 'include_none',
  'lookup_dependent_question', 'lookup_label', 'lookup_table', 'lookup_unique', 'lookup_value',
  'default_value', 'example_text', 'hidden', 'macro',
  'mandatory', 'map_to_field', 'name', 'order', 'question_text', 'read_only',
  'reference', 'reference_qual', 'reference_qual_condition', 'sp_widget',
  'sys_class_name', 'sys_id', 'sys_name', 'type', 'variable_set',
  // Conversacional: rotulo que a VA le no lugar da pergunta, exclusao da
  // interface conversacional, e o Topic Block que destrava tipo Personalizado.
  'conversational_label', 'not_available_conversation', 'topic_block',
  // Configuradores. Em Container Start/Split/End e Break e aqui que mora o
  // layout (colunas), o titulo e a largura; nas demais, ajuda, mascara, regex,
  // qualificador e visibilidade por contexto. Todos conferidos no sys_dictionary
  // (question > item_option_new).
  'layout', 'display_title', 'variable_width', 'visibility', 'attributes',
  'show_help', 'show_help_on_load', 'help_text', 'instructions', 'tooltip', 'rich_text',
  'unique', 'validate_regex', 'do_not_select_first', 'scale_min', 'scale_max', 'list_table',
  'use_reference_qualifier', 'dynamic_ref_qual', 'use_dynamic_default', 'dynamic_default_value',
  'default_html_value', 'mask_use_confirmation', 'mask_use_encryption',
  'visible_standalone', 'visible_summary', 'visible_guide', 'visible_bundle', 'hide_on_grid',
  'read_roles', 'write_roles', 'create_roles',
  // Scripts da variavel. Entram so como `script_understanding` (DIRETRIZ #3):
  // o build.js troca o texto cru pelo slot.
  'read_script', 'post_insert_script', 'save_script',
  'sys_created_on', 'sys_created_by', 'sys_updated_on', 'sys_updated_by',
];

/** Dos campos de VARIABLE_FIELDS, os que sao script. O cru nunca sai no JSON. */
export const VARIABLE_SCRIPT_FIELDS = ['read_script', 'post_insert_script', 'save_script'];

export const CHOICE_FIELDS = ['question', 'text', 'value', 'order', 'inactive', 'sys_id'];

export const SET_LINK_FIELDS = ['order', 'sc_cat_item', 'sys_id', 'variable_set'];

export const SET_FIELDS = [
  'description', 'display_title', 'internal_name', 'layout', 'name', 'order',
  'sys_class_name', 'sys_id', 'title', 'type',
  'set_attributes', 'read_roles', 'write_roles', 'create_roles',
];

export const UI_POLICY_FIELDS = [
  'active', 'applies_catalog', 'applies_req_item', 'applies_sc_task',
  'applies_target_record', 'applies_to', 'catalog_conditions', 'catalog_item',
  'isolate_script', 'on_load', 'order', 'short_description', 'sys_class_name',
  'sys_id', 'ui_type', 'va_supported', 'variable_set',
  'description', 'global', 'inherit', 'reverse_if_false', 'run_scripts', 'view',
  // Os dois scripts da policy entram so como `script_understanding` (build.js).
  'script_true', 'script_false',
  'sys_created_on', 'sys_created_by', 'sys_updated_on', 'sys_updated_by',
];

export const UI_POLICY_ACTION_FIELDS = [
  'catalog_item', 'catalog_variable', 'cleared', 'disabled', 'mandatory',
  'order', 'sys_class_name', 'sys_id', 'sys_name', 'ui_policy', 'value',
  'value_action', 'variable', 'variable_set', 'visible',
  'field_message', 'field_message_type',
];

export const CLIENT_SCRIPT_FIELDS = [
  'active', 'applies_catalog', 'applies_extended', 'applies_req_item',
  'applies_sc_task', 'applies_target_record', 'applies_to', 'cat_item',
  'cat_variable', 'condition', 'field', 'isolate_script', 'name', 'script',
  'sys_id', 'sys_policy', 'type', 'ui_type', 'va_supported', 'variable_set',
  'description', 'order', 'messages', 'global', 'view',
  'sys_created_on', 'sys_created_by', 'sys_updated_on', 'sys_updated_by',
];

export const UC_LINK_FIELDS = ['sc_cat_item', 'sys_class_name', 'sys_id', 'user_criteria'];

export const USER_CRITERIA_FIELDS = [
  'active', 'advanced', 'company', 'department', 'group', 'location',
  'match_all', 'name', 'role', 'script', 'sys_id', 'sys_name', 'user',
  'sys_created_on', 'sys_created_by', 'sys_updated_on', 'sys_updated_by',
];

/** Campos Glide List: multi-valor, tratados por `snList`. */
export const LIST_FIELDS = new Set([
  'sc_catalogs', 'role', 'user', 'group', 'company', 'department', 'location', 'roles',
]);

// ---------------------------------------------------------------------------
// Objetos relacionados as TABELAS DESTINO dos itens mapeados (nao ao item).
// Saem em colecoes proprias no topo do JSON, como variable_sets.
// Todos os nomes conferidos no sys_dictionary desta instancia — sys_report NAO
// tem group_by/order_by/chart_type, e sp_portal usa `inactive`, nao `active`.
// ---------------------------------------------------------------------------

/** Notificacoes. O CORPO (message/message_html) fica de fora por decisao do usuario. */
export const NOTIFICATION_FIELDS = [
  'sys_id', 'sys_name', 'sys_class_name', 'name', 'active', 'collection', 'description',
  'type', 'category', 'event_name', 'generation_type', 'action_insert', 'action_update',
  'affected_field_on_event', 'event_parm_1', 'event_parm_2',
  'condition', 'advanced_condition',
  'subject', 'from', 'reply_to', 'importance', 'template', 'style',
  'recipient_users', 'recipient_groups', 'recipient_fields', 'exclude_delegates', 'send_self',
  'force_delivery', 'mandatory', 'subscribable', 'digestable', 'weight', 'order',
  'item', 'item_table', 'sys_updated_on', 'sys_updated_by',
];

/** SLA e OLA — o `type` separa os dois. */
export const SLA_FIELDS = [
  'sys_id', 'sys_name', 'sys_class_name', 'name', 'active', 'collection', 'type', 'target',
  'duration', 'duration_type', 'relative_duration_works_on',
  'schedule', 'schedule_source', 'schedule_source_field', 'timezone', 'timezone_source',
  'set_start_to', 'start_condition', 'pause_condition', 'resume_condition', 'stop_condition',
  'cancel_condition', 'when_to_cancel', 'when_to_resume', 'reset_condition', 'reset_action',
  'condition_class', 'adv_condition_type', 'retroactive', 'retroactive_pause', 'enable_logging',
  'flow', 'workflow', 'vendor', 'sys_overrides', 'sys_updated_on',
];

export const REPORT_FIELDS = [
  'sys_id', 'sys_name', 'sys_class_name', 'title', 'table', 'type', 'description', 'active',
  'filter', 'field_list', 'aggregate', 'aggregation_source', 'column', 'source_type',
  'report_source', 'user', 'roles', 'is_scheduled', 'is_published', 'display_grid',
  'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on',
];

export const REPORT_SHARE_FIELDS = ['sys_id', 'report_id', 'user_id', 'group_id'];

export const PORTAL_FIELDS = [
  'sys_id', 'sys_name', 'sys_class_name', 'title', 'url_suffix', 'inactive', 'default',
  'homepage', 'login_page', 'notfound_page', 'sc_catalog', 'sc_catalog_page', 'sc_category_page',
  'kb_knowledge_base', 'kb_knowledge_page', 'theme', 'dark_theme', 'logo', 'icon',
  'enable_portal_authentication', 'enable_local_login', 'enable_favorites', 'enable_ais',
  'hide_portal_name', 'alternate_portal', 'sp_rectangle_menu', 'sys_updated_on',
];

export const PORTAL_CATALOG_FIELDS = ['sys_id', 'sp_portal', 'sc_catalog', 'active', 'order'];

/**
 * `service_offering` — opcoes de variaveis que apontam para ela (`reference_choices`).
 * Usada so em instancia com regra propria (ver referenceChoices.js). Todos os
 * nomes conferidos no sys_dictionary da Assai QA; `sla`/`u_ola_*` apontam para a
 * DEFINICAO de SLA, `u_flow*` para o Flow, `u_user_criteria` para o acesso.
 */
export const SERVICE_OFFERING_FIELDS = [
  'sys_id', 'name', 'number', 'short_description', 'description', 'parent',
  'operational_status', 'install_status', 'used_for', 'u_area', 'u_order',
  'support_group', 'managed_by_group', 'owned_by', 'managed_by',
  'sla', 'u_ola_a', 'u_ola_r', 'u_flow', 'u_flow_task',
  'u_has_approver', 'u_has_approver_group', 'u_approval_sequence', 'u_task_sequence',
  'u_task_assign', 'u_auto_dispatch', 'u_automatic_cancellation',
  'u_user_criteria', 'u_locations', 'u_elegivel', 'u_pdv_type', 'u_disable_view', 'u_grant_only',
  'u_type_of_event', 'u_topics', 'u_type_ombudsman', 'u_finance_impact',
  'u_categorias_dos_temas_report', 'u_grupo', 'u_grupo_tipo_de_ocorr_ncia_report',
  'u_manager', 'u_request', 'u_incident', 'u_pdv', 'u_casino',
  'u_catalog_item', 'u_catalog_items', 'sys_updated_on', 'sys_updated_by',
];

/** Glide Lists da `service_offering` (tipo `glide_list` no dicionario). */
export const SERVICE_OFFERING_LIST_FIELDS = new Set([
  'u_catalog_items', 'u_user_criteria', 'u_locations', 'u_elegivel', 'u_pdv_type',
]);

/** Glide Lists das tabelas relacionadas — por tabela, para nao contaminar o resto. */
export const RELATED_LIST_FIELDS = new Set(['recipient_users', 'recipient_groups']);
