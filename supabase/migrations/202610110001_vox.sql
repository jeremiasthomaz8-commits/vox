CREATE SCHEMA vox;
SET search_path = vox, pg_catalog;
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE units (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  device_id TEXT NOT NULL UNIQUE, demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN(0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('admin','unit')), unit_id TEXT REFERENCES units(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), must_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((role='admin' AND unit_id IS NULL) OR (role='unit' AND unit_id IS NOT NULL))
);
CREATE UNIQUE INDEX usernames_case_insensitive ON users(lower(username));
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
  csrf TEXT NOT NULL, created_at BIGINT NOT NULL, touched_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start BIGINT NOT NULL
);

ALTER TABLE photographic_evidence ADD COLUMN encrypted_data BYTEA;
ALTER TABLE photographic_evidence ADD COLUMN expires_at TEXT;
ALTER TABLE photographic_evidence ADD COLUMN content_hash TEXT;
CREATE INDEX evidence_expiry ON photographic_evidence(status, expires_at);

CREATE FUNCTION sao_day(value TEXT) RETURNS TEXT LANGUAGE SQL STABLE SET search_path=pg_catalog AS $$ SELECT to_char(value::timestamptz AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') $$;
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Audit records are immutable'; END $$;
CREATE TRIGGER audit_immutable_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
INSERT INTO schema_migrations VALUES(1,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
INSERT INTO settings(id,updated_at) VALUES(1,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
INSERT INTO categories VALUES(1,'Atendimento da equipe','Como foi o atendimento da equipe?',1);
INSERT INTO categories VALUES(2,'Atendimento médico','Como foi o atendimento médico?',2);
INSERT INTO categories VALUES(3,'Higiene e limpeza','Como estavam a higiene e a limpeza?',3);
INSERT INTO categories VALUES(4,'Organização da unidade','Como foi a organização da unidade?',4);
INSERT INTO categories VALUES(5,'Comunicação visual','As placas e orientações estavam claras?',5);
INSERT INTO categories VALUES(6,'Satisfação geral','De modo geral, como foi sua experiência?',6);
DO $$ DECLARE t text; r text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='vox' LOOP EXECUTE format('ALTER TABLE vox.%I ENABLE ROW LEVEL SECURITY',t); END LOOP;
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
 EXECUTE format('REVOKE ALL ON SCHEMA vox FROM %I',r);
 EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA vox FROM %I',r);
 EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vox FROM %I',r);
 END LOOP;
END $$;
REVOKE ALL ON SCHEMA vox FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vox FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vox FROM PUBLIC;
RESET search_path;
