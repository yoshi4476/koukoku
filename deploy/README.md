# ADGRID デプロイ手順（GitHub + Vercel + Railway）

```
GitHub (ソース)
   ├─→ Vercel   ── Web (Next.js)
   └─→ Railway  ── API (NestJS)
                └─ PostgreSQL
                └─ Redis (定期実行)
```

| 役割 | サービス | 理由 |
|---|---|---|
| Web（Next.js） | **Vercel** | Next.js純正。ビルドもキャッシュも最適 |
| API（NestJS） | **Railway** | 常駐サーバ・BullMQの定期実行が必要なため |
| PostgreSQL | **Railway** | APIと同じネットワークで遅延が小さく、管理先が1つにまとまる |
| Redis | **Railway** | 週次レポート・異常検知・媒体同期・予算提案の定期実行に必要 |

---

## ⚠️ 最重要：テナント分離（RLS）について

PostgreSQL では **テーブルの所有者は行レベルセキュリティ(RLS)を迂回します**。
アプリをテーブル所有者ロール（Railwayの既定 `postgres` など）で接続すると、**テナント分離が完全に無効化され、全クライアントのデータが混ざります。**

そのため必ず2つのロールに分けます。

| 用途 | ロール | 環境変数 |
|---|---|---|
| マイグレーション（テーブル作成） | `postgres` | `DATABASE_URL` |
| **アプリ実行（通常のDB操作）** | **`adgrid_app`**（所有者ではない） | **`APP_DATABASE_URL`** |

アプリは起動時に「存在しないテナントIDで行が見えないか」を**実測**します。分離が効いていなければ**本番では起動を停止**します。ログに `テナント分離OK (role=adgrid_app)` が出れば正常です。

---

## ⚠️ 次に重要：ドメインが分かれることの影響

WebがVercel、APIがRailwayになるため、ブラウザから見て**クロスサイト**になります。対応済みですが、設定を誤ると**ログインできません**。

| 項目 | 対応 |
|---|---|
| セッションCookie | 本番は自動で `SameSite=None; Secure` になります（HTTPS必須） |
| CORS | APIの `WEB_ORIGIN` にVercelのURLを**正確に**設定（末尾スラッシュ不要） |

---

## STEP 1. GitHub

```bash
cd "c:\Users\user\Desktop\システム開発\広告システム"
git push -u origin main
```

`.env` は `.gitignore` 済みです。**秘密情報はすべて各サービスの環境変数**に入れてください。

---

## STEP 2. Railway（API + DB + Redis）

### 2-1. プロジェクト作成
1. https://railway.app → **New Project → Deploy from GitHub repo** → `koukoku`
2. **New → Database → PostgreSQL** を追加
3. **New → Database → Redis** を追加

### 2-2. APIサービスの設定
- **Settings → Build**
  - Builder: **Dockerfile**
  - Dockerfile Path: `Dockerfile.api`
- **Settings → Networking → Generate Domain**
  → 例 `https://koukoku-api.up.railway.app`（控える）

### 2-3. アプリ用DBロールを作成（分離のため必須）

RailwayのPostgreSQLサービス → **Data**（またはQueryタブ）で次を実行します。
`CHANGE_ME_STRONG_PASSWORD` は**必ず強いパスワードに変更**してください。

```sql
create role adgrid_app with login password 'CHANGE_ME_STRONG_PASSWORD' nobypassrls;
grant usage on schema public to adgrid_app;
grant select, insert, update, delete on all tables in schema public to adgrid_app;
grant usage, select on all sequences in schema public to adgrid_app;
alter default privileges in schema public grant select, insert, update, delete on tables to adgrid_app;
alter default privileges in schema public grant usage, select on sequences to adgrid_app;
```

> **実行タイミング**：初回デプロイでマイグレーションが走り、テーブルが作られた**後**に実行します。
> 新しいテーブルを追加するマイグレーション後は、`grant ... on all tables` の2行を再実行してください
> （`alter default privileges` は以降の自動付与用です）。

検証用SQL（`adgrid_app` の `rolbypassrls` が **false** であること）:

```sql
select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('adgrid_app','postgres');
```

### 2-4. APIサービスの環境変数

Railway の PostgreSQL / Redis は接続変数を自動で共有します。`${{...}}` はそのまま貼れます。

| 変数 | 値 |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`（マイグレーション用） |
| `APP_DATABASE_URL` | 上の接続文字列の**ユーザー名とパスワードを `adgrid_app` に差し替えたもの** |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `AUTH_SECRET` | 下の生成コマンドの出力 |
| `TOKEN_ENCRYPTION_KEY` | 同じ方法で生成（**別の値**） |
| `WEB_ORIGIN` | VercelのURL（例 `https://koukoku.vercel.app`）※末尾スラッシュなし |
| `API_ORIGIN` | RailwayのAPI URL |

鍵の生成:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**機能を有効化するキー（任意・未設定でも動作）**
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `META_CAPI_ACCESS_TOKEN` / `GA4_API_SECRET` /
`GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` /
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` / `SLACK_SIGNING_SECRET` / `SLACK_REPORT_WEBHOOK_URL` / `STRIPE_SECRET_KEY`

---

## STEP 3. Vercel（Web）

1. https://vercel.com → **Add New → Project** → `koukoku` をインポート
2. **Root Directory は変更しない**（リポジトリのルートのまま）
   - `vercel.json` がモノレポのビルド手順を指定しています
3. **Environment Variables**

| 変数 | 値 |
|---|---|
| `NEXT_PUBLIC_API_BASE` | RailwayのAPI URL（例 `https://koukoku-api.up.railway.app`） |

> `NEXT_PUBLIC_*` は**ビルド時に埋め込まれます**。値を変えたら**再デプロイが必要**です。

4. Deploy → 発行されたURL（例 `https://koukoku.vercel.app`）を控える
5. **Railway に戻り `WEB_ORIGIN` をこのURLに設定して再デプロイ**

### プレビュー環境も使う場合（任意）
VercelのプレビューはURLが毎回変わります。APIに次を追加すると許可できます。

| 変数 | 値 |
|---|---|
| `VERCEL_PREVIEW_SUFFIX` | `.vercel.app` |

---

## STEP 4. 初期データ（任意）

マイグレーションはデプロイ時に自動適用されます。デモデータを入れる場合のみ:

```bash
cd apps/api
DATABASE_URL='<RailwayのDATABASE_URL>' pnpm db:seed
```

> ⚠️ シードは**既存データを削除します**。実運用開始後は絶対に実行しないでください。

---

## STEP 5. 動作確認

1. **Railwayのログ**に `テナント分離OK (role=adgrid_app)` が出ているか
   - 出ない／起動に失敗する → `APP_DATABASE_URL` が `postgres` のままです
2. VercelのURLを開き、**ログインできるか**
   - できない → `WEB_ORIGIN` がVercelのURLと完全一致しているか確認（CORS）
3. **設定 → 外部連携ステータス**で各キーの認識を確認

---

## デプロイ後に外部サービス側で更新するもの

| サービス | 更新箇所 | 値 |
|---|---|---|
| Google Cloud | 承認済みリダイレクトURI | `https://<API>/connections/google_ads/callback` |
| Slack App | Slash Command の Request URL | `https://<API>/slack/command` |
| クライアントのサイト | CV送信先 | `https://<API>/collect/<トークン>` |

---

## つまずいたら

| 症状 | 原因と対処 |
|---|---|
| APIが起動せず「テナント分離が機能していません」 | `APP_DATABASE_URL` が所有者ロール。`adgrid_app` に変更 |
| `permission denied for table ...` | 新しいテーブルに権限が無い。2-3 の `grant ... on all tables` を再実行 |
| **ログインできない／すぐログアウトされる** | クロスサイトCookie。`WEB_ORIGIN` がVercelのURLと完全一致しているか、両方HTTPSか確認 |
| CORSエラー | 同上。末尾スラッシュを付けない |
| 画面のAPI接続先が localhost のまま | `NEXT_PUBLIC_API_BASE` 設定後に**再デプロイ**が必要 |
| 週次レポート等が動かない | `REDIS_URL` が未設定 |
| **アップロード画像が消える** | Railwayのファイルシステムは再デプロイで消えます。永続化には Volume か外部ストレージ（S3/R2）が必要 |
