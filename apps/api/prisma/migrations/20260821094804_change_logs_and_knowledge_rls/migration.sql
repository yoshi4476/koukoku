-- change_logs: テナント分離 (B-2)
ALTER TABLE change_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON change_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- knowledge_assets: 匿名共有ナレッジ (tenant_id IS NULL) の作成を許可 (B-1昇格のオプトイン)。
-- 他テナントの tenant_id は current_setting と一致しないため詐称不可。
DROP POLICY IF EXISTS tenant_write ON knowledge_assets;
CREATE POLICY tenant_write ON knowledge_assets
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);
