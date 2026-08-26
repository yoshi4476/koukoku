-- システム管理 (F-61): SaaS運営者が全テナントを横断把握するための経路。
--
-- 解除するのは tenants テーブルの**行の可視性のみ**。clients/projects/fact_ad_performance 等の
-- 業務データは従来どおり tenant_id ポリシーで分離されたままで、運営者であっても
-- withTenant() でそのテナントに入らない限り中身は読めない。
--
-- app.platform_admin は PrismaService.withPlatformAdmin() の中でのみ設定される。
-- 通常の業務API経路では一切設定されないため、既存の分離挙動は変わらない。
-- (set_config の第3引数 true によりトランザクション終了で自動的に失効する)
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (
    id = current_setting('app.tenant_id', true)
    OR parent_tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    id = current_setting('app.tenant_id', true)
    OR parent_tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.platform_admin', true) = 'on'
  );
