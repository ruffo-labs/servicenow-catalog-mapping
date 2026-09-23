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
];

export const CHOICE_FIELDS = ['question', 'text', 'value', 'order', 'inactive', 'sys_id'];

export const SET_LINK_FIELDS = ['order', 'sc_cat_item', 'sys_id', 'variable_set'];

export const SET_FIELDS = [
  'description', 'display_title', 'internal_name', 'layout', 'name', 'order',
  'sys_class_name', 'sys_id', 'title', 'type',
];

export const UI_POLICY_FIELDS = [
  'active', 'applies_catalog', 'applies_req_item', 'applies_sc_task',
  'applies_target_record', 'applies_to', 'catalog_conditions', 'catalog_item',
  'isolate_script', 'on_load', 'order', 'short_description', 'sys_class_name',
  'sys_id', 'ui_type', 'va_supported', 'variable_set',
];

export const UI_POLICY_ACTION_FIELDS = [
  'catalog_item', 'catalog_variable', 'cleared', 'disabled', 'mandatory',
  'order', 'sys_class_name', 'sys_id', 'sys_name', 'ui_policy', 'value',
  'value_action', 'variable', 'variable_set', 'visible',
];

export const CLIENT_SCRIPT_FIELDS = [
  'active', 'applies_catalog', 'applies_extended', 'applies_req_item',
  'applies_sc_task', 'applies_target_record', 'applies_to', 'cat_item',
  'cat_variable', 'condition', 'field', 'isolate_script', 'name', 'script',
  'sys_id', 'sys_policy', 'type', 'ui_type', 'va_supported', 'variable_set',
];

export const UC_LINK_FIELDS = ['sc_cat_item', 'sys_class_name', 'sys_id', 'user_criteria'];

export const USER_CRITERIA_FIELDS = [
  'active', 'advanced', 'company', 'department', 'group', 'location',
  'match_all', 'name', 'role', 'script', 'sys_id', 'sys_name', 'user',
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

/** Glide Lists das tabelas relacionadas — por tabela, para nao contaminar o resto. */
export const RELATED_LIST_FIELDS = new Set(['recipient_users', 'recipient_groups']);
