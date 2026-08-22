-- measurement_configs: テナント分離 (F-46)
ALTER TABLE measurement_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON measurement_configs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
