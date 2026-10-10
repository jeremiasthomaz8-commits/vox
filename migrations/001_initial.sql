PRAGMA foreign_keys = ON;
CREATE TABLE units (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  device_id TEXT NOT NULL UNIQUE, demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN(0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('admin','unit')), unit_id TEXT REFERENCES units(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), must_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((role='admin' AND unit_id IS NULL) OR (role='unit' AND unit_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_account_per_unit ON users(unit_id) WHERE role='unit';
CREATE TABLE categories (
  id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 6), name TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL, display_order INTEGER NOT NULL UNIQUE
);
CREATE TABLE evaluations (
  id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL, device_id TEXT NOT NULL, submitted_by TEXT REFERENCES users(id),
  idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
  photo_status TEXT NOT NULL DEFAULT 'disabled' CHECK(photo_status IN('disabled','declined','camera_unavailable','permission_denied','capture_failed','captured','deleted')),
  complete INTEGER NOT NULL DEFAULT 1 CHECK(complete=1), demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN(0,1))
);
CREATE INDEX evaluations_period_unit ON evaluations(created_at,unit_id);
CREATE INDEX evaluations_unit_period ON evaluations(unit_id,created_at);
CREATE TABLE responses (
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), PRIMARY KEY(evaluation_id,category_id)
);
CREATE TABLE photographic_evidence (
  id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id),
  private_reference TEXT, authorization_record TEXT, captured_at TEXT, deleted_at TEXT,
  status TEXT NOT NULL CHECK(status IN('captured','declined','camera_unavailable','permission_denied','capture_failed','deleted'))
);
CREATE TABLE alerts (
  id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id), type TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE, detected_at TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN('attention','critical')), evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Novo' CHECK(status IN('Novo','Em análise','Revisado','Encerrado')),
  notes TEXT NOT NULL DEFAULT '', demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE alert_history (
  id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES alerts(id), actor_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, status TEXT NOT NULL, notes TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  target TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_created ON audit_logs(created_at);
CREATE TRIGGER audit_immutable_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id=1), score_threshold REAL NOT NULL DEFAULT 70 CHECK(score_threshold BETWEEN 0 AND 100),
  sample_min INTEGER NOT NULL DEFAULT 30 CHECK(sample_min BETWEEN 5 AND 1000),
  repeat_threshold INTEGER NOT NULL DEFAULT 5 CHECK(repeat_threshold BETWEEN 3 AND 50),
  concentration_threshold INTEGER NOT NULL DEFAULT 12 CHECK(concentration_threshold BETWEEN 5 AND 100),
  decline_threshold INTEGER NOT NULL DEFAULT 15 CHECK(decline_threshold BETWEEN 5 AND 100),
  volume_change_threshold INTEGER NOT NULL DEFAULT 100 CHECK(volume_change_threshold BETWEEN 25 AND 1000),
  high_threshold INTEGER NOT NULL DEFAULT 90 CHECK(high_threshold BETWEEN 50 AND 100),
  photo_retention_days INTEGER NOT NULL DEFAULT 30 CHECK(photo_retention_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL
);
