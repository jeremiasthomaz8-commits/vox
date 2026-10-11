-- Cover foreign keys used by joins, session revocation and referential checks.
CREATE INDEX alert_history_actor_idx ON vox.alert_history(actor_id);
CREATE INDEX alert_history_alert_created_idx ON vox.alert_history(alert_id,created_at);
CREATE INDEX alerts_unit_detected_idx ON vox.alerts(unit_id,detected_at);
CREATE INDEX audit_actor_created_idx ON vox.audit_logs(actor_id,created_at);
CREATE INDEX evaluations_submitted_by_idx ON vox.evaluations(submitted_by);
CREATE INDEX responses_category_evaluation_idx ON vox.responses(category_id,evaluation_id);
CREATE INDEX sessions_user_idx ON vox.sessions(user_id);
INSERT INTO vox.schema_migrations VALUES(2,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
