-- ab_tests: テナント分離 (B-3)
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ab_tests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
