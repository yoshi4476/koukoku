-- project_assets: テナント分離 (F-19)
ALTER TABLE project_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_assets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
