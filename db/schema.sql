-- ============================================================================
-- HOUSE OF KALA KATHA — Product Operations System
-- Schema v1  (SQLite dialect; portable to Postgres — see docs/ARCHITECTURE.md)
--
-- Conventions
--   * ids      : TEXT cuid, generated in app code
--   * booleans : INTEGER 0/1
--   * JSON     : TEXT holding a JSON document (parsed in app code)
--   * enums    : TEXT + CHECK constraints; authoritative list lives in
--                src/lib/types.ts so the UI can render labels
-- ============================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- IDENTITY / ACCESS
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "user" (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role_key              TEXT NOT NULL REFERENCES role(key),
  job_title             TEXT,
  phone                 TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  invite_token          TEXT UNIQUE,
  password_reset_token  TEXT UNIQUE,
  password_reset_at     TEXT,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_role ON "user"(role_key);
CREATE INDEX IF NOT EXISTS idx_user_active ON "user"(is_active);

CREATE TABLE IF NOT EXISTS session (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- --------------------------------------------------------------------------
-- TAXONOMY — Category != HandloomCulture != Collection
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS category (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  slug             TEXT NOT NULL UNIQUE,
  sku_segment      TEXT UNIQUE,          -- SAR, APP ...
  parent_id        TEXT REFERENCES category(id) ON DELETE SET NULL,
  shopify_category TEXT,
  shopify_type     TEXT,
  template_key     TEXT NOT NULL DEFAULT 'GENERIC',  -- SAREE | APPAREL | GENERIC
  image_template_id TEXT REFERENCES image_slot_template(id) ON DELETE SET NULL,
  description      TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_archived      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_category_parent ON category(parent_id);
CREATE INDEX IF NOT EXISTS idx_category_archived ON category(is_archived);

CREATE TABLE IF NOT EXISTS handloom_culture (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  code              TEXT NOT NULL UNIQUE,  -- ZK, BAL ...
  region            TEXT,
  state             TEXT,
  country           TEXT DEFAULT 'India',
  description       TEXT,
  history           TEXT,
  technique         TEXT,
  significance      TEXT,
  typical_materials TEXT,
  typical_motifs    TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_culture_archived ON handloom_culture(is_archived);

CREATE TABLE IF NOT EXISTS collection (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  handle      TEXT NOT NULL UNIQUE,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'CUSTOMER',
  is_archived INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_archived ON collection(is_archived);

-- --------------------------------------------------------------------------
-- IMAGE SLOT TEMPLATES
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS image_slot_template (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_slot_definition (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES image_slot_template(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  file_suffix TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  guidance    TEXT,
  UNIQUE (template_id, key)
);

-- --------------------------------------------------------------------------
-- DYNAMIC ATTRIBUTE SCHEMA
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attribute_field (
  id          TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  group_key   TEXT NOT NULL,
  group_label TEXT NOT NULL,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'TEXT',
  options     TEXT NOT NULL DEFAULT '[]',
  unit        TEXT,
  is_required INTEGER NOT NULL DEFAULT 0,
  track_gap   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (template_key, key)
);
CREATE INDEX IF NOT EXISTS idx_attr_template ON attribute_field(template_key, group_key);

CREATE TABLE IF NOT EXISTS product_attribute_value (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  field_id   TEXT NOT NULL REFERENCES attribute_field(id) ON DELETE CASCADE,
  value      TEXT NOT NULL DEFAULT '',
  is_missing INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  UNIQUE (product_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_pav_field ON product_attribute_value(field_id);

-- --------------------------------------------------------------------------
-- SIZE GUIDES
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS size_guide (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  unit        TEXT NOT NULL DEFAULT 'cm',
  applies_to  TEXT NOT NULL DEFAULT 'APPAREL',
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS size_guide_column (
  id           TEXT PRIMARY KEY,
  size_guide_id TEXT NOT NULL REFERENCES size_guide(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (size_guide_id, key)
);

CREATE TABLE IF NOT EXISTS size_guide_row (
  id           TEXT PRIMARY KEY,
  size_guide_id TEXT NOT NULL REFERENCES size_guide(id) ON DELETE CASCADE,
  size_label   TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (size_guide_id, size_label)
);

CREATE TABLE IF NOT EXISTS size_guide_cell (
  id        TEXT PRIMARY KEY,
  row_id    TEXT NOT NULL REFERENCES size_guide_row(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES size_guide_column(id) ON DELETE CASCADE,
  value     TEXT NOT NULL DEFAULT '',
  UNIQUE (row_id, column_id)
);

-- --------------------------------------------------------------------------
-- PRODUCT
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product (
  id                TEXT PRIMARY KEY,
  sku               TEXT NOT NULL UNIQUE,
  internal_reference TEXT,
  name              TEXT,
  name_status       TEXT NOT NULL DEFAULT 'NOT_NAMED'
                    CHECK (name_status IN ('NOT_NAMED','NAMING_REQUIRED','NAME_PROPOSED','NAME_APPROVED')),
  status            TEXT NOT NULL DEFAULT 'DRAFT',

  category_id       TEXT REFERENCES category(id) ON DELETE SET NULL,
  subcategory_id    TEXT REFERENCES category(id) ON DELETE SET NULL,
  handloom_culture_id TEXT REFERENCES handloom_culture(id) ON DELETE SET NULL,
  region            TEXT,
  state             TEXT,
  gender            TEXT,
  target_audience   TEXT,
  occasion          TEXT,
  season            TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  internal_notes    TEXT,

  product_type_label TEXT,
  colour            TEXT,
  fabric            TEXT,
  fabric_composition TEXT,
  material          TEXT,
  weave             TEXT,
  technique         TEXT,
  pattern           TEXT,
  motifs            TEXT,
  border            TEXT,
  pallu             TEXT,
  weight            REAL,
  weight_unit       TEXT NOT NULL DEFAULT 'g',
  care_instructions TEXT,
  packaging_notes   TEXT,

  saree_length      REAL,
  saree_width       REAL,
  blouse_included   INTEGER,
  blouse_length     REAL,
  blouse_fabric     TEXT,
  blouse_colour     TEXT,
  zari              TEXT,
  transparency      TEXT,
  fall_pico_status  TEXT,

  fit               TEXT,
  neckline          TEXT,
  sleeve            TEXT,
  garment_length    TEXT,
  closure           TEXT,
  lining            TEXT,
  pockets           TEXT,
  stretch           TEXT,

  artisan_name          TEXT,
  artisan_story         TEXT,
  craft_story           TEXT,
  historical_context    TEXT,
  cultural_significance TEXT,
  yarn                  TEXT,
  zari_type             TEXT,
  dyeing_method         TEXT,
  embroidery            TEXT,
  special_techniques    TEXT,
  certification         TEXT,
  origin                TEXT,

  size_guide_id   TEXT REFERENCES size_guide(id) ON DELETE SET NULL,
  length_unit     TEXT NOT NULL DEFAULT 'cm',
  measurements    TEXT NOT NULL DEFAULT '[]',

  short_description TEXT,
  full_description  TEXT,
  story             TEXT,
  about_the_weave   TEXT,
  about_the_artisan TEXT,
  details           TEXT NOT NULL DEFAULT '[]',
  care              TEXT,
  shipping_notes    TEXT,

  price             REAL,
  compare_at_price  REAL,
  cost_price        REAL,
  currency          TEXT NOT NULL DEFAULT 'INR',
  taxable           INTEGER NOT NULL DEFAULT 1,
  tax_code          TEXT,
  discount_eligible INTEGER NOT NULL DEFAULT 1,

  inventory_qty     INTEGER,
  inventory_policy  TEXT NOT NULL DEFAULT 'deny',
  inventory_tracker TEXT NOT NULL DEFAULT 'shopify',
  track_inventory   INTEGER NOT NULL DEFAULT 1,

  seo_title        TEXT,
  seo_description  TEXT,
  handle           TEXT UNIQUE,
  handle_locked    INTEGER NOT NULL DEFAULT 0,
  shopify_status   TEXT NOT NULL DEFAULT 'draft' CHECK (shopify_status IN ('active','draft','archived')),
  published        INTEGER NOT NULL DEFAULT 0,
  published_at     TEXT,
  template_suffix  TEXT,
  vendor           TEXT,
  shopify_product_id TEXT,
  last_exported_at TEXT,
  last_export_run_id TEXT,

  requires_shipping INTEGER NOT NULL DEFAULT 1,
  hs_code           TEXT,
  country_of_origin TEXT DEFAULT 'IN',

  assignee_id    TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_by_id  TEXT NOT NULL REFERENCES "user"(id),
  modified_by_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,

  completeness_score  INTEGER NOT NULL DEFAULT 0,
  readiness_state     TEXT NOT NULL DEFAULT 'BLOCKED' CHECK (readiness_state IN ('READY','WARNINGS','BLOCKED')),
  readiness_score     INTEGER NOT NULL DEFAULT 0,
  readiness_issues    TEXT NOT NULL DEFAULT '[]',
  photography_complete INTEGER NOT NULL DEFAULT 0,
  photography_required INTEGER NOT NULL DEFAULT 0,

  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_status     ON product(status);
CREATE INDEX IF NOT EXISTS idx_product_category   ON product(category_id);
CREATE INDEX IF NOT EXISTS idx_product_culture    ON product(handloom_culture_id);
CREATE INDEX IF NOT EXISTS idx_product_assignee   ON product(assignee_id);
CREATE INDEX IF NOT EXISTS idx_product_name_status ON product(name_status);
CREATE INDEX IF NOT EXISTS idx_product_archived   ON product(is_archived);
CREATE INDEX IF NOT EXISTS idx_product_readiness  ON product(readiness_state);
CREATE INDEX IF NOT EXISTS idx_product_updated    ON product(updated_at);
CREATE INDEX IF NOT EXISTS idx_product_created    ON product(created_at);
CREATE INDEX IF NOT EXISTS idx_product_sku        ON product(sku);
-- Performance indexes for dashboard and catalog filters
CREATE INDEX IF NOT EXISTS idx_product_completeness ON product(completeness_score);
CREATE INDEX IF NOT EXISTS idx_product_photography ON product(photography_required, photography_complete);
CREATE INDEX IF NOT EXISTS idx_product_price ON product(price);
CREATE INDEX IF NOT EXISTS idx_product_colour ON product(colour);
CREATE INDEX IF NOT EXISTS idx_product_fabric ON product(fabric);
CREATE INDEX IF NOT EXISTS idx_product_composite ON product(is_archived, status, readiness_state);
CREATE INDEX IF NOT EXISTS idx_product_archived_status ON product(is_archived, status);
CREATE INDEX IF NOT EXISTS idx_product_archived_readiness ON product(is_archived, readiness_state);

CREATE TABLE IF NOT EXISTS product_collection (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  added_by_id   TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (product_id, collection_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_collection ON product_collection(collection_id);
CREATE INDEX IF NOT EXISTS idx_pc_product ON product_collection(product_id);
CREATE INDEX IF NOT EXISTS idx_pc_product_collection ON product_collection(product_id, collection_id);

CREATE TABLE IF NOT EXISTS variant (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL UNIQUE,
  title         TEXT,
  position      INTEGER NOT NULL DEFAULT 1,
  option1_name  TEXT DEFAULT 'Title',
  option1_value TEXT DEFAULT 'Default Title',
  option2_name  TEXT,
  option2_value TEXT,
  option3_name  TEXT,
  option3_value TEXT,
  price         REAL,
  compare_at_price REAL,
  cost_price    REAL,
  inventory_qty INTEGER NOT NULL DEFAULT 0,
  weight        REAL,
  weight_unit   TEXT NOT NULL DEFAULT 'g',
  barcode       TEXT,
  taxable       INTEGER NOT NULL DEFAULT 1,
  requires_shipping INTEGER NOT NULL DEFAULT 1,
  inventory_policy  TEXT NOT NULL DEFAULT 'deny',
  inventory_tracker TEXT NOT NULL DEFAULT 'shopify',
  track_inventory   INTEGER NOT NULL DEFAULT 1,
  image_url     TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variant_product ON variant(product_id);

-- --------------------------------------------------------------------------
-- IMAGES
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_image (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  slot_id        TEXT REFERENCES image_slot_definition(id) ON DELETE SET NULL,
  file_name      TEXT NOT NULL,
  storage_key    TEXT NOT NULL,
  path           TEXT NOT NULL,
  public_url     TEXT,
  mime_type      TEXT NOT NULL,
  bytes          INTEGER NOT NULL DEFAULT 0,
  width          INTEGER,
  height         INTEGER,
  folder         TEXT NOT NULL DEFAULT 'ORIGINAL' CHECK (folder IN ('ORIGINAL','FINAL')),
  alt_text       TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_primary     INTEGER NOT NULL DEFAULT 0,
  review_status  TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by_id TEXT,
  reviewed_at    TEXT,
  storage_backend TEXT NOT NULL DEFAULT 'LOCAL',
  drive_file_id  TEXT,
  drive_folder_id TEXT,
  checksum       TEXT,
  duplicate_of_id TEXT REFERENCES product_image(id) ON DELETE SET NULL,
  uploaded_by_id TEXT NOT NULL REFERENCES "user"(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_product ON product_image(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_image_slot    ON product_image(slot_id);

-- --------------------------------------------------------------------------
-- NAMING / GAPS / COLLABORATION
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS name_proposal (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  proposed_name  TEXT NOT NULL,
  rationale      TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
  proposed_by_id TEXT NOT NULL REFERENCES "user"(id),
  decided_by_id  TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  decided_at     TEXT,
  decision_note  TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposal_product ON name_proposal(product_id, status);

CREATE TABLE IF NOT EXISTS product_gap (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  section       TEXT NOT NULL DEFAULT 'GENERAL',
  severity      TEXT NOT NULL DEFAULT 'REQUIRED' CHECK (severity IN ('REQUIRED','RECOMMENDED')),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  created_by_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (product_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_gap_status ON product_gap(status, severity);

CREATE TABLE IF NOT EXISTS comment (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  mentions    TEXT NOT NULL DEFAULT '[]',
  is_resolved INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_product ON comment(product_id, created_at);

CREATE TABLE IF NOT EXISTS assignment (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  task_type     TEXT NOT NULL CHECK (task_type IN ('CONTENT','PHOTOGRAPHY','REVIEW','APPROVAL','DATA')),
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  note          TEXT,
  due_at        TEXT,
  created_by_id TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (product_id, user_id, task_type)
);
CREATE INDEX IF NOT EXISTS idx_assignment_user ON assignment(user_id, status);

CREATE TABLE IF NOT EXISTS product_review (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES "user"(id),
  decision   TEXT NOT NULL CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
  checklist  TEXT NOT NULL DEFAULT '{}',
  comment    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_product ON product_review(product_id, created_at);

-- --------------------------------------------------------------------------
-- AUDIT / VERSION HISTORY
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  entity_label TEXT,
  action       TEXT NOT NULL,
  changes      TEXT NOT NULL DEFAULT '[]',
  meta         TEXT,
  user_id      TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS product_snapshot (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  reason     TEXT,
  data       TEXT NOT NULL,
  user_id    TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, version)
);

-- --------------------------------------------------------------------------
-- SHOPIFY EXPORT
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shopify_field_mapping (
  id         TEXT PRIMARY KEY,
  schema_key TEXT NOT NULL UNIQUE,
  column     TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'PRODUCT',
  section    TEXT NOT NULL DEFAULT 'CORE',
  enabled    INTEGER NOT NULL DEFAULT 1,
  required   INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes      TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_run (
  id             TEXT PRIMARY KEY,
  number         INTEGER NOT NULL UNIQUE,
  mode           TEXT NOT NULL CHECK (mode IN ('NEW','UPDATE','FULL')),
  status         TEXT NOT NULL DEFAULT 'GENERATED',
  product_count  INTEGER NOT NULL DEFAULT 0,
  ready_count    INTEGER NOT NULL DEFAULT 0,
  warning_count  INTEGER NOT NULL DEFAULT 0,
  blocked_count  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  file_name      TEXT,
  file_path      TEXT,
  bytes          INTEGER,
  schema_version TEXT NOT NULL,
  schema_key     TEXT NOT NULL DEFAULT 'shopify-product-csv',
  summary        TEXT NOT NULL DEFAULT '{}',
  include_images INTEGER NOT NULL DEFAULT 1,
  public_base_url TEXT,
  user_id        TEXT NOT NULL REFERENCES "user"(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_export_date ON export_run(created_at);

CREATE TABLE IF NOT EXISTS export_run_product (
  id         TEXT PRIMARY KEY,
  export_id  TEXT NOT NULL REFERENCES export_run(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('READY','WARNINGS','BLOCKED')),
  issues     TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (export_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_export_product ON export_run_product(export_id, state);

-- --------------------------------------------------------------------------
-- IMPORT
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_run (
  id               TEXT PRIMARY KEY,
  file_name        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'UPLOADED',
  row_count        INTEGER NOT NULL DEFAULT 0,
  imported_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count    INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  duplicate_count  INTEGER NOT NULL DEFAULT 0,
  column_mapping   TEXT NOT NULL DEFAULT '{}',
  detected_columns TEXT NOT NULL DEFAULT '[]',
  header_row       INTEGER NOT NULL DEFAULT 1,
  error            TEXT,
  user_id          TEXT NOT NULL REFERENCES "user"(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_date ON import_run(created_at);

CREATE TABLE IF NOT EXISTS import_row (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES import_run(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,
  raw_data    TEXT NOT NULL DEFAULT '{}',
  mapped_data TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'PENDING',
  issues      TEXT NOT NULL DEFAULT '[]',
  product_id  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_importrow_status ON import_row(import_id, status);
CREATE INDEX IF NOT EXISTS idx_importrow_number ON import_row(import_id, row_number);
