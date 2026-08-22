-- リセラー型 (F-23): 親テナント(自社)が子テナント(他社)の tenants 行を参照できるようにする。
-- 子テナントの業務データ(clients/projects等)は各テーブルの tenant_id ポリシーで引き続き分離される。
-- 参照できるのは tenants 行のメタ情報(名前・版)のみで、切替(withTenant)しない限り子の中身は読めない。
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (
    id = current_setting('app.tenant_id', true)
    OR parent_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (id = current_setting('app.tenant_id', true));
