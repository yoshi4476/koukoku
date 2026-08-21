-- dashboards: テナント分離 (B-5)
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboards
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
