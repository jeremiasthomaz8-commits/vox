ALTER TABLE photographic_evidence ADD COLUMN encrypted_data BLOB;
ALTER TABLE photographic_evidence ADD COLUMN expires_at TEXT;
ALTER TABLE photographic_evidence ADD COLUMN content_hash TEXT;
CREATE INDEX evidence_expiry ON photographic_evidence(status, expires_at);
