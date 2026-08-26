/**
 * アプリ実行用のDBロールを用意する (デプロイ時に毎回実行される)。
 *
 * PostgreSQL では「テーブルの所有者」は行レベルセキュリティ(RLS)を迂回する。
 * マイグレーションを流す管理者ロール(postgres等)でアプリを動かすとテナント分離が
 * 無効化されるため、所有者ではない専用ロールを用意し、アプリはそちらで接続する。
 *
 * マイグレーションの「後」に実行することで、新しく追加されたテーブルにも
 * 毎回もれなく権限が付与される (手作業のGRANT忘れを防ぐ)。
 *
 * 必要な環境変数:
 *   DATABASE_URL     … 管理者ロール (マイグレーションと同じもの)
 *   APP_DB_PASSWORD  … 作成するロールのパスワード。未設定ならスキップする
 *   APP_DB_USER      … ロール名 (既定 adgrid_app)
 */
const { PrismaClient } = require('@prisma/client');

const USER = process.env.APP_DB_USER || 'adgrid_app';
const PASSWORD = process.env.APP_DB_PASSWORD;

/** ロール名は識別子として埋め込むため、英小文字・数字・アンダースコアだけ許可する */
function assertSafeIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`APP_DB_USER に使えない文字が含まれています: ${name}`);
  }
}

async function main() {
  if (!PASSWORD) {
    console.log('[ensure-app-role] APP_DB_PASSWORD が未設定のためスキップします');
    return;
  }
  assertSafeIdent(USER);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[ensure-app-role] DATABASE_URL が未設定のためスキップします');
    return;
  }

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    // パスワードはリテラルとして安全にエスケープする (単引用符の二重化)
    const pw = PASSWORD.replace(/'/g, "''");

    // ① ロールを作成 (既にあればパスワードだけ更新)
    await prisma.$executeRawUnsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${USER}') then
          create role ${USER} with login password '${pw}' nobypassrls;
        else
          alter role ${USER} with login password '${pw}' nobypassrls;
        end if;
      end
      $$;
    `);

    // ② 権限付与。マイグレーション後に実行されるため新テーブルも対象になる
    await prisma.$executeRawUnsafe(`grant usage on schema public to ${USER}`);
    await prisma.$executeRawUnsafe(`grant select, insert, update, delete on all tables in schema public to ${USER}`);
    await prisma.$executeRawUnsafe(`grant usage, select on all sequences in schema public to ${USER}`);
    // ③ 今後作られるオブジェクトにも自動付与
    await prisma.$executeRawUnsafe(`alter default privileges in schema public grant select, insert, update, delete on tables to ${USER}`);
    await prisma.$executeRawUnsafe(`alter default privileges in schema public grant usage, select on sequences to ${USER}`);

    // ④ 検証: RLSを迂回しないこと
    const rows = await prisma.$queryRawUnsafe(
      `select rolbypassrls as bypass, rolsuper as super from pg_roles where rolname = '${USER}'`,
    );
    const r = rows[0] || {};
    if (r.bypass || r.super) {
      throw new Error(`ロール ${USER} が特権を持っています (bypassrls=${r.bypass} super=${r.super})`);
    }
    console.log(`[ensure-app-role] ロール ${USER} を準備しました (RLS適用対象)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[ensure-app-role] 失敗:', e.message);
  process.exit(1);
});
