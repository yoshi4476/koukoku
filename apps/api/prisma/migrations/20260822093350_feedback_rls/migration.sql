-- feedback: テナント分離 (提供先アクセス F-22)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
