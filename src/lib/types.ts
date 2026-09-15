/**
 * Domain types. Enum-like fields are plain strings in SQLite; these unions are
 * the single source of truth for allowed values and their human labels.
 */

// ---------------------------------------------------------------------------
// Product workflow (spec §6)
// ---------------------------------------------------------------------------
export const PRODUCT_STATUSES = [
  'DRAFT',
  'INFORMATION_REQUIRED',
  'INFORMATION_COMPLETE',
  'PHOTOGRAPHY_REQUIRED',
  'PHOTOGRAPHY_COMPLETE',
  'CONTENT_REVIEW',
  'INTERNAL_REVIEW',
  'FOUNDER_APPROVAL',
  'SHOPIFY_READY',
  'EXPORTED',
  'PUBLISHED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'ARCHIVED',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  INFORMATION_REQUIRED: 'Information required',
  INFORMATION_COMPLETE: 'Information complete',
  PHOTOGRAPHY_REQUIRED: 'Photography required',
  PHOTOGRAPHY_COMPLETE: 'Photography complete',
  CONTENT_REVIEW: 'Content review',
  INTERNAL_REVIEW: 'Internal review',
  FOUNDER_APPROVAL: 'Founder approval',
  SHOPIFY_READY: 'Shopify ready',
  EXPORTED: 'Exported',
  PUBLISHED: 'Published',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

/** Tone used by status pills. */
export const STATUS_TONE: Record<ProductStatus, 'neutral' | 'info' | 'warn' | 'danger' | 'success'> = {
  DRAFT: 'neutral',
  INFORMATION_REQUIRED: 'warn',
  INFORMATION_COMPLETE: 'info',
  PHOTOGRAPHY_REQUIRED: 'warn',
  PHOTOGRAPHY_COMPLETE: 'info',
  CONTENT_REVIEW: 'info',
  INTERNAL_REVIEW: 'info',
  FOUNDER_APPROVAL: 'info',
  SHOPIFY_READY: 'success',
  EXPORTED: 'success',
  PUBLISHED: 'success',
  CHANGES_REQUESTED: 'warn',
  REJECTED: 'danger',
  ARCHIVED: 'neutral',
};

export const NAME_STATUSES = ['NOT_NAMED', 'NAMING_REQUIRED', 'NAME_PROPOSED', 'NAME_APPROVED'] as const;
export type NameStatus = (typeof NAME_STATUSES)[number];
export const NAME_STATUS_LABELS: Record<NameStatus, string> = {
  NOT_NAMED: 'Not named',
  NAMING_REQUIRED: 'Naming required',
  NAME_PROPOSED: 'Name proposed',
  NAME_APPROVED: 'Name approved',
};

export const READINESS_STATES = ['READY', 'WARNINGS', 'BLOCKED'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export const TASK_TYPES = ['CONTENT', 'PHOTOGRAPHY', 'REVIEW', 'APPROVAL', 'DATA'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CONTENT: 'Content',
  PHOTOGRAPHY: 'Photography',
  REVIEW: 'Review',
  APPROVAL: 'Approval',
  DATA: 'Data entry',
};

export const REVIEW_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const EXPORT_MODES = ['NEW', 'UPDATE', 'FULL'] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];
export const EXPORT_MODE_LABELS: Record<ExportMode, string> = {
  NEW: 'New products (create)',
  UPDATE: 'Update existing products',
  FULL: 'Full catalog',
};

export const IMAGE_FOLDERS = ['ORIGINAL', 'FINAL'] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

export const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'DATE'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  is_system: number;
  permissions: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role_key: string;
  job_title: string | null;
  phone: string | null;
  is_active: number;
  must_change_password: number;
  invite_token: string | null;
  password_reset_token: string | null;
  password_reset_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  role_name?: string;
  role_permissions?: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  internal_reference: string | null;
  name: string | null;
  name_status: NameStatus;
  status: ProductStatus;
  category_id: string | null;
  subcategory_id: string | null;
  handloom_culture_id: string | null;
  region: string | null;
  state: string | null;
  gender: string | null;
  target_audience: string | null;
  occasion: string | null;
  season: string | null;
  tags: string;
  internal_notes: string | null;
  product_type_label: string | null;
  colour: string | null;
  fabric: string | null;
  fabric_composition: string | null;
  material: string | null;
  weave: string | null;
  technique: string | null;
  pattern: string | null;
  motifs: string | null;
  border: string | null;
  pallu: string | null;
  weight: number | null;
  weight_unit: string;
  care_instructions: string | null;
  packaging_notes: string | null;
  saree_length: number | null;
  saree_width: number | null;
  blouse_included: number | null;
  blouse_length: number | null;
  blouse_fabric: string | null;
  blouse_colour: string | null;
  zari: string | null;
  transparency: string | null;
  fall_pico_status: string | null;
  fit: string | null;
  neckline: string | null;
  sleeve: string | null;
  garment_length: string | null;
  closure: string | null;
  lining: string | null;
  pockets: string | null;
  stretch: string | null;
  artisan_name: string | null;
  artisan_story: string | null;
  craft_story: string | null;
  historical_context: string | null;
  cultural_significance: string | null;
  yarn: string | null;
  zari_type: string | null;
  dyeing_method: string | null;
  embroidery: string | null;
  special_techniques: string | null;
  certification: string | null;
  origin: string | null;
  size_guide_id: string | null;
  length_unit: string;
  measurements: string;
  short_description: string | null;
  full_description: string | null;
  story: string | null;
  about_the_weave: string | null;
  about_the_artisan: string | null;
  details: string;
  care: string | null;
  shipping_notes: string | null;
  price: number | null;
  compare_at_price: number | null;
  cost_price: number | null;
  currency: string;
  taxable: number;
  tax_code: string | null;
  discount_eligible: number;
  inventory_qty: number | null;
  inventory_policy: string;
  inventory_tracker: string;
  track_inventory: number;
  seo_title: string | null;
  seo_description: string | null;
  handle: string | null;
  handle_locked: number;
  shopify_status: string;
  published: number;
  published_at: string | null;
  template_suffix: string | null;
  vendor: string | null;
  shopify_product_id: string | null;
  last_exported_at: string | null;
  last_export_run_id: string | null;
  requires_shipping: number;
  hs_code: string | null;
  country_of_origin: string | null;
  assignee_id: string | null;
  created_by_id: string;
  modified_by_id: string | null;
  completeness_score: number;
  readiness_state: ReadinessState;
  readiness_score: number;
  readiness_issues: string;
  photography_complete: number;
  photography_required: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  // joined fields (list queries)
  category_name?: string | null;
  subcategory_name?: string | null;
  culture_name?: string | null;
  culture_code?: string | null;
  assignee_name?: string | null;
  creator_name?: string | null;
  template_key?: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  sku_segment: string | null;
  parent_id: string | null;
  shopify_category: string | null;
  shopify_type: string | null;
  template_key: string;
  image_template_id: string | null;
  description: string | null;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  parent_name?: string | null;
}

export interface CultureRow {
  id: string;
  name: string;
  slug: string;
  code: string;
  region: string | null;
  state: string | null;
  country: string | null;
  description: string | null;
  history: string | null;
  technique: string | null;
  significance: string | null;
  typical_materials: string | null;
  typical_motifs: string | null;
  is_archived: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionRow {
  id: string;
  name: string;
  slug: string;
  handle: string;
  description: string | null;
  kind: string;
  is_archived: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_count?: number;
}

export interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  title: string | null;
  position: number;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  price: number | null;
  compare_at_price: number | null;
  cost_price: number | null;
  inventory_qty: number;
  weight: number | null;
  weight_unit: string;
  barcode: string | null;
  taxable: number;
  requires_shipping: number;
  inventory_policy: string;
  inventory_tracker: string;
  track_inventory: number;
  image_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  slot_id: string | null;
  file_name: string;
  storage_key: string;
  path: string;
  public_url: string | null;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  folder: ImageFolder;
  alt_text: string | null;
  sort_order: number;
  is_primary: number;
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  storage_backend: string;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  checksum: string | null;
  duplicate_of_id: string | null;
  uploaded_by_id: string;
  created_at: string;
  updated_at: string;
  slot_key?: string | null;
  slot_label?: string | null;
  slot_suffix?: string | null;
  uploader_name?: string | null;
}

export interface ImageSlotRow {
  id: string;
  template_id: string;
  key: string;
  label: string;
  file_suffix: string;
  is_required: number;
  sort_order: number;
  guidance: string | null;
}

export interface AttributeFieldRow {
  id: string;
  template_key: string;
  group_key: string;
  group_label: string;
  key: string;
  label: string;
  field_type: FieldType;
  options: string;
  unit: string | null;
  is_required: number;
  track_gap: number;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  value?: string;
  is_missing?: number;
  note?: string | null;
}

export interface SizeGuideRow {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  applies_to: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  product_id: string;
  user_id: string;
  body: string;
  mentions: string;
  is_resolved: number;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_role?: string;
}

export interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  action: string;
  changes: string;
  meta: string | null;
  user_id: string | null;
  created_at: string;
  user_name?: string | null;
}

export interface ExportRunRow {
  id: string;
  number: number;
  mode: ExportMode;
  status: string;
  product_count: number;
  ready_count: number;
  warning_count: number;
  blocked_count: number;
  error_count: number;
  file_name: string | null;
  file_path: string | null;
  bytes: number | null;
  schema_version: string;
  schema_key: string;
  summary: string;
  include_images: number;
  public_base_url: string | null;
  user_id: string;
  created_at: string;
  user_name?: string;
}

export interface FieldChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface Issue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  section?: string;
}
