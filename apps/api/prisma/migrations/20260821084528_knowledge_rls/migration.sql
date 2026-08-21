-- knowledge_assets: テナント固有行は分離、共有ナレッジ (tenant_id IS NULL) は全テナント可視 (B-1)
ALTER TABLE knowledge_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_shared ON knowledge_assets
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);
-- 書込は自テナント行、または匿名共有ナレッジ (tenant_id IS NULL) のみ。
-- 共有はオプトイン時に昇格処理が匿名化して作成する (他テナントの tenant_id は詐称不可)。
CREATE POLICY tenant_write ON knowledge_assets
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- calibration_stats はテナント横断の匿名集計 (tenant_id を持たない) のため RLS 対象外。
-- adgrid_app には既定の grant があり、read/write 可能。
