-- proposals: テナント分離 (F-16)
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON proposals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
