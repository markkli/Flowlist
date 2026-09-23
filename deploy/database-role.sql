-- Run as the migration owner AFTER Alembic upgrade, in a dedicated beta project.
-- Create the role without a password in this script; set its password securely
-- through your SQL client (psql: \password flowlist_api). Do not commit passwords.
CREATE ROLE flowlist_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO flowlist_api;
DO $$
DECLARE table_name text; seq_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['app_users','goals','tasks','focus_sessions','focus_session_tasks','focus_queue','focus_blocks']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO flowlist_api', table_name);
    -- The server performs per-account authorization. This server-only role can
    -- access app rows; anon/authenticated cannot bypass the API with Supabase REST.
    EXECUTE format('CREATE POLICY flowlist_server_access ON public.%I TO flowlist_api USING (true) WITH CHECK (true)', table_name);
    seq_name := NULL;
    IF table_name NOT IN ('focus_queue', 'app_users') THEN
      seq_name := pg_get_serial_sequence(format('public.%I',table_name), 'id');
    END IF;
    IF seq_name IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO flowlist_api', seq_name);
    END IF;
  END LOOP;
END $$;
