-- lift_tests: テナント分離 (F-42)
ALTER TABLE lift_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lift_tests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
