-- ============================================================
--  ADGRID: Supabase セットアップ
--  Supabase の SQL Editor で、マイグレーション適用「後」に1回だけ実行する。
--
--  ■ なぜ必要か（最重要）
--  PostgreSQL では「テーブルの所有者」は行レベルセキュリティ(RLS)を迂回する。
--  Supabase の postgres ロールは全テーブルの所有者になるため、
--  アプリを postgres で接続するとテナント分離が完全に無効化される。
--  そのため「所有者ではない専用ロール」を作り、アプリはそちらで接続する。
--
--  ■ 手順
--   1. 下の adgrid_app_password を強いパスワードに書き換える
--   2. このSQL全体を実行する
--   3. アプリの APP_DATABASE_URL をこのロールの接続文字列にする
--   4. アプリ起動時に「テナント分離OK」がログに出ることを確認する
-- ============================================================

-- ① アプリ実行用ロール（所有者ではない・RLSをバイパスしない）
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'adgrid_app') then
    -- ↓↓↓ パスワードを必ず変更する ↓↓↓
    create role adgrid_app with login password 'CHANGE_ME_STRONG_PASSWORD' nobypassrls;
  end if;
end
$$;

-- ② スキーマと既存テーブルへの権限（DDLは与えない＝アプリはテーブルを作れない）
grant usage on schema public to adgrid_app;
grant select, insert, update, delete on all tables in schema public to adgrid_app;
grant usage, select on all sequences in schema public to adgrid_app;

-- ③ 今後マイグレーションで追加されるテーブルにも自動で権限を付与する
--    ※ マイグレーションを実行するロール（postgres）が作るオブジェクトが対象
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to adgrid_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to adgrid_app;

-- ④ 検証: RLSが有効なテーブルの一覧（tenant_id を持つ業務テーブルは true であること）
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relkind = 'r'
  and relnamespace = 'public'::regnamespace
  and relname in (
    'clients','ad_accounts','metrics_daily','audits','reports','projects','project_assets',
    'proposals','alert_events','change_logs','deals','lift_tests','measurement_configs',
    'conversion_events','keyword_stats','ab_tests','audit_trail','llm_calls','feedback'
  )
order by relrowsecurity, relname;

-- ⑤ 検証: adgrid_app が BYPASSRLS を持たないこと（false であること）
select rolname, rolbypassrls, rolsuper
from pg_roles
where rolname in ('adgrid_app', 'postgres');

-- ============================================================
--  ■ 接続文字列の作り方
--  Supabase ダッシュボード → Project Settings → Database → Connection string
--  の host / port / database をそのまま使い、ユーザー名とパスワードだけ差し替える。
--
--  APP_DATABASE_URL  … アプリ実行用（adgrid_app）
--    postgresql://adgrid_app:<パスワード>@<host>:5432/postgres?schema=public
--
--  DATABASE_URL      … マイグレーション用（postgres）
--    postgresql://postgres:<パスワード>@<host>:5432/postgres?schema=public
--
--  ※ ポート 6543 の Transaction pooler は Prisma の対話型トランザクションと
--    相性問題が出ることがある。まずは 5432（Session/Direct）を使う。
-- ============================================================
