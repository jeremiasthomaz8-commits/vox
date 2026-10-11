-- Apply once after the schema migration, as the database administrator.
-- Supply a random LOGIN password separately through a private provisioning channel.
CREATE ROLE vox_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
GRANT CONNECT ON DATABASE postgres TO vox_app;
GRANT USAGE ON SCHEMA vox TO vox_app;
GRANT SELECT ON ALL TABLES IN SCHEMA vox TO vox_app;
GRANT INSERT,UPDATE,DELETE ON vox.units,vox.users,vox.evaluations,vox.responses,
  vox.photographic_evidence,vox.alerts,vox.alert_history,vox.settings,vox.sessions,vox.login_attempts TO vox_app;
GRANT INSERT ON vox.audit_logs TO vox_app;
GRANT EXECUTE ON FUNCTION vox.sao_day(TEXT) TO vox_app;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='vox' LOOP
    EXECUTE format('CREATE POLICY vox_server ON vox.%I TO vox_app USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
