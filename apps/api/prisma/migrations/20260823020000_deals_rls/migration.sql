-- deals: テナント分離 (F-47)
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
