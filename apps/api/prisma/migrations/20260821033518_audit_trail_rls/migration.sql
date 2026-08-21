-- audit_trail: テナント分離 + 追記専用 (UPDATE/DELETE不可) — 要件書 §10 監査ログ
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_trail
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
REVOKE UPDATE, DELETE ON audit_trail FROM adgrid_app;
