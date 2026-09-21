/** Listas de campos por tabela. Validadas contra sys_dictionary antes do uso. */

export const ITEM_FIELDS = [
  'active', 'category', 'description', 'name', 'order', 'sc_catalogs',
  'short_description', 'state', 'sys_class_name', 'sys_id', 'sys_name', 'type',
  'flow_designer_flow', 'workflow',
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
