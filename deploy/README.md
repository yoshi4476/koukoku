# ADGRID デプロイ手順（GitHub + Supabase + Railway）

```
GitHub (ソース)
   ↓ 自動デプロイ
Railway ── API (NestJS)  ──┐
       └─ Web (Next.js)   ├─→ Supabase (PostgreSQL)
       └─ Redis (定期実行) ┘
```

---

## ⚠️ 最重要：テナント分離について

PostgreSQL では **テーブルの所有者は行レベルセキュリティ(RLS)を迂回します**。
Supabase の `postgres` ロールは全テーブルの所有者になるため、**アプリを `postgres` で接続するとテナント分離が完全に無効化され、全社のデータが混ざります。**

そのため必ず次のように分けます。

| 用途 | ロール | 環境変数 |
|---|---|---|
| マイグレーション（テーブル作成） | `postgres` | `DATABASE_URL` |
| **アプリ実行（通常のDB操作）** | **`adgrid_app`**（所有者ではない） | **`APP_DATABASE_URL`** |

アプリは起動時に「存在しないテナントで行が見えないか」を実測します。分離が効いていなければ **本番では起動を停止**します（ログに `テナント分離OK` が出れば正常）。

---

## STEP 1. Supabase（データベース）

1. https://supabase.com でプロジェクトを作成（リージョンは **Tokyo (ap-northeast-1)** 推奨）
2. **Project Settings → Database → Connection string** から接続情報を控える
3. **SQL Editor** で [`deploy/supabase-setup.sql`](./supabase-setup.sql) を開く
   - `CHANGE_ME_STRONG_PASSWORD` を**強いパスワードに書き換えてから**実行
   - ※ マイグレーション適用後にもう一度実行すると、新しいテーブルにも権限が付きます
4. 接続文字列を2本用意する

```
DATABASE_URL      = postgresql://postgres:<パスワード>@<host>:5432/postgres?schema=public
APP_DATABASE_URL  = postgresql://adgrid_app:<設定したパスワード>@<host>:5432/postgres?schema=public
```

> ポート **5432**（Session/Direct）を使ってください。6543 の Transaction pooler は Prisma の対話型トランザクションと相性問題が出ることがあります。

---

## STEP 2. GitHub（ソース）

```bash
git remote add origin https://github.com/yoshi4476/koukoku.git
git add -A
git commit -m "..."
git push -u origin main
```

`.env` は `.gitignore` 済みです。**秘密情報は必ず Railway の環境変数**に入れてください。

---

## STEP 3. Railway（アプリ）

### 3-1. プロジェクト作成
1. https://railway.app → **New Project → Deploy from GitHub repo** → `koukoku` を選択
2. 同じリポジトリから **2つのサービス**を作ります

### 3-2. API サービス
- **Settings → Build**
  - Builder: **Dockerfile**
  - Dockerfile Path: `Dockerfile.api`
- **Variables**（下記「環境変数」参照）
- **Settings → Networking → Generate Domain** で公開URLを取得（例 `https://adgrid-api.up.railway.app`）

### 3-3. Web サービス
- **Settings → Build**
  - Builder: **Dockerfile**
  - Dockerfile Path: `Dockerfile.web`
  - **Build Arg**: `NEXT_PUBLIC_API_BASE` = APIの公開URL
    （Next.js は `NEXT_PUBLIC_*` を**ビルド時に埋め込む**ため、変数だけでは反映されません）
- **Variables**: `NEXT_PUBLIC_API_BASE` にもAPIの公開URLを設定
- **Generate Domain** で公開URLを取得（例 `https://adgrid.up.railway.app`）

### 3-4. Redis（定期実行に必要）
- **New → Database → Redis** を追加
- APIサービスの `REDIS_URL` に Railway が発行する接続URLを設定
- 未設定でもアプリは動きますが、**週次レポート・異常検知・媒体同期・予算提案の自動実行が止まります**

### 3-5. 相互のURLを設定して再デプロイ
両方のURLが確定したら、APIの `WEB_ORIGIN` / `API_ORIGIN` を埋めて再デプロイします。

---

## 環境変数（Railway → API サービス）

### 必須
| 変数 | 値 |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase（`postgres` ロール）※マイグレーション用 |
| `APP_DATABASE_URL` | Supabase（**`adgrid_app` ロール**）※アプリ実行用 |
| `AUTH_SECRET` | ランダムな長い文字列。生成 → `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TOKEN_ENCRYPTION_KEY` | 媒体トークンの暗号化キー。同じ方法で生成（別の値にする） |
| `WEB_ORIGIN` | Webの公開URL（例 `https://adgrid.up.railway.app`） |
| `API_ORIGIN` | APIの公開URL（例 `https://adgrid-api.up.railway.app`） |

### 機能を有効化するもの（任意・未設定でも動作）
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `META_CAPI_ACCESS_TOKEN` / `GA4_API_SECRET` /
`GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` /
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` / `SLACK_SIGNING_SECRET` / `SLACK_REPORT_WEBHOOK_URL` /
`STRIPE_SECRET_KEY` / `REDIS_URL`

### Railway → Web サービス
| 変数 | 値 |
|---|---|
| `NEXT_PUBLIC_API_BASE` | APIの公開URL（**Build Arg にも同じ値**） |

---

## STEP 4. 初期データ投入（初回のみ）

デプロイ時にマイグレーションは自動適用されます（`prisma migrate deploy`）。
デモデータを入れる場合はローカルから実行します。

```bash
cd apps/api
DATABASE_URL='postgresql://postgres:<パスワード>@<host>:5432/postgres?schema=public' \
  pnpm db:seed
```

> 実運用データを入れる場合、シードは既存データを削除するため**実行しないでください**。

---

## STEP 5. 動作確認

1. **APIのログ**に `テナント分離OK (role=adgrid_app)` が出ているか
   - 出ていなければ `APP_DATABASE_URL` が `postgres` になっている可能性があります
2. Webの公開URLを開いてログインできるか
3. **設定 → 外部連携ステータス**で各キーの認識を確認
4. Google広告を使う場合、Google Cloud の OAuth 承認済みリダイレクトURIに
   `https://<APIの公開URL>/connections/google_ads/callback` を追加

---

## 外部サービス側で更新が必要な設定

デプロイ後、URLが変わるため次を更新します。

| サービス | 更新箇所 | 値 |
|---|---|---|
| Google Cloud | 承認済みリダイレクトURI | `https://<API>/connections/google_ads/callback` |
| Slack App | Slash Command の Request URL | `https://<API>/slack/command` |
| クライアントのサイト | CV送信先 | `https://<API>/collect/<トークン>` |

---

## つまずいたら

| 症状 | 原因と対処 |
|---|---|
| APIが起動せず「テナント分離が機能していません」 | `APP_DATABASE_URL` が `postgres` ロールになっている。`adgrid_app` に変更 |
| 「permission denied for table」 | `supabase-setup.sql` をマイグレーション後に再実行して権限を付与 |
| Webから API に繋がらない | APIの `WEB_ORIGIN` がWebの公開URLと一致しているか（CORS） |
| 画面のAPI接続先が localhost のまま | `NEXT_PUBLIC_API_BASE` を **Build Arg** にも設定して再ビルド |
| 週次レポートが動かない | `REDIS_URL` が未設定 |
| アップロード画像が消える | Railwayのファイルシステムは再デプロイで消えます。永続化には Volume か外部ストレージが必要 |
