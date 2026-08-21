-- keyword_stats: テナント分離 (キーワード最適化 F-18)
ALTER TABLE keyword_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keyword_stats
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
