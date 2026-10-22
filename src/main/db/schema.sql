CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, viewport_json TEXT, background TEXT);
CREATE TABLE assets (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, vault_path TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT, size_bytes INTEGER,
  extracted_text TEXT, thumb_path TEXT, extract_status TEXT NOT NULL CHECK (extract_status IN ('memproses','siap','gagal')), created_at TEXT NOT NULL);
CREATE TABLE asset_tags (asset_id TEXT NOT NULL REFERENCES assets(id), tag TEXT NOT NULL, PRIMARY KEY (asset_id, tag));
CREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), type TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  z INTEGER NOT NULL DEFAULT 0, asset_id TEXT REFERENCES assets(id), content TEXT, style_json TEXT);
CREATE TABLE links (id TEXT PRIMARY KEY, from_card_id TEXT NOT NULL REFERENCES cards(id), to_card_id TEXT NOT NULL REFERENCES cards(id), kind TEXT NOT NULL);
CREATE TABLE prompts (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, lane TEXT NOT NULL CHECK (lane IN ('cloud','lokal','kode')),
  target_model TEXT, template TEXT NOT NULL, variables_json TEXT, examples_json TEXT, version INTEGER NOT NULL DEFAULT 1, parent_version_id TEXT REFERENCES prompts(id));
CREATE TABLE generations (id TEXT PRIMARY KEY, prompt_id TEXT REFERENCES prompts(id), prompt_version INTEGER, variables_json TEXT, model TEXT, params_json TEXT,
  lane TEXT NOT NULL, credit_cost REAL, status TEXT NOT NULL CHECK (status IN ('antre','berjalan','selesai','gagal')),
  result_asset_id TEXT REFERENCES assets(id), source_card_id TEXT REFERENCES cards(id), created_at TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT, status TEXT NOT NULL CHECK (status IN ('antre','berjalan','selesai','gagal')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE assets_fts USING fts5(asset_id UNINDEXED, original_name, tags, extracted_text);
