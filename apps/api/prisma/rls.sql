-- ============================================================
-- Row Level Security (要件書 §④/§10)
-- アプリは非特権ロール adgrid_app で接続し、
-- 各リクエストのトランザクション内で
--   SELECT set_config('app.tenant_id', $tenantId, true)
-- を実行する。ポリシーは current_setting('app.tenant_id') と一致する
-- 行のみを可視・書込可能にする。
-- (テーブル所有者 adgrid_admin = マイグレーション/seed はRLS対象外)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'adgrid_app') THEN
    CREATE ROLE adgrid_app LOGIN PASSWORD 'adgrid_app_local';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO adgrid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adgrid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adgrid_app;

-- tenants は「自分のテナント行のみ可視」
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

-- tenant_id を持つ全業務テーブルに同一ポリシーを付与
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'ad_accounts', 'media_connections', 'fact_ad_performance',
    'csv_imports', 'audits', 'reports', 'copy_jobs', 'llm_calls'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true))
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END
$$;
