# ADGRID — 統合広告運用SaaS (MVP)

「アカウントを接続するだけで、日本一の運用者と同じ水準の診断・戦略・改善提案・レポートが毎日自動で届く」広告運用SaaS。

設計書一式 (要件定義 v2.1 / AIロジック / デザインシステム / 媒体API連携 / オンボーディング) はアーティファクトを参照。本リポジトリはその Phase 1 MVP 実装。

## 構成

```
apps/api        NestJS API (port 4000) — RLSマルチテナント / AI診断・レポート・広告文 / CSV取込
apps/web        Next.js App Router (port 3000) — 司令室 / ダッシュボード / 診断 / レポート / 広告文 / 媒体窓口
packages/shared 型・zodスキーマ・媒体マスタ (API契約の正)
docs/           API契約
```

## クイックスタート

```bash
pnpm install
cp env.example .env           # 任意 (未作成でもローカルデフォルトで動く)
pnpm db:up                    # Postgres(55433) + Redis(56379) を Docker で起動
DATABASE_URL="postgresql://adgrid_admin:adgrid_local_dev@localhost:55433/adgrid?schema=public" \
  pnpm db:migrate             # マイグレーション (RLSポリシー含む)
DATABASE_URL="postgresql://adgrid_admin:adgrid_local_dev@localhost:55433/adgrid?schema=public" \
  pnpm db:seed                # デモデータ (デモ代理店 + 3クライアント + 28日実績)
pnpm --filter @adgrid/shared build
pnpm dev                      # api:4000 + web:3000
```

http://localhost:3000 を開く。

**ログイン**: デモアカウント `demo@adgrid.jp` / `demo-pass-2026`、または新規登録 → オンボーディング (初回3ステップ: クライアント登録 → データ接続 (CSV/サンプル) → 初回AI診断が自動実行)。
セッションは httpOnly クッキー (JWT)。curl等の開発ツールは `x-tenant-id` ヘッダでのフォールバック可 (本番は `ALLOW_TENANT_HEADER=false` で無効化)。

## AI機能のモード

- `ANTHROPIC_API_KEY` **未設定**: モックモードで動作。/audit はルールベース診断 (計測欠落・予算ペーシング・CPA悪化・疲弊検出)、/report はテンプレート生成、/copy はテンプレート生成。**法規制辞書チェックと文字数検証は常に実動作**。
- **設定済み**: Claude API (audit=Opus 5 / report・copy=Sonnet 5) + プロンプトレジストリ (`apps/api/src/ai/prompt-registry.ts`) で実行。全呼出は `llm_calls` にトークン・原価 (JPY) を記録。

## セキュリティ設計 (実装済み)

- **PostgreSQL RLS**: 全業務テーブルにテナント分離ポリシー。アプリは非特権ロール `adgrid_app` で接続し、リクエストごとに `set_config('app.tenant_id', ...)` をトランザクションローカルに設定。WHERE句漏れがあってもDB層で他テナント行に到達できない
- **AI出力の検証**: 構造化出力を zod で検証し、/audit の引用数値は入力データと機械突合 (不一致の指摘は破棄)。プロンプトにデータ信頼境界 (インジェクション対策) を常設

## 実装済み / 未実装

| 済 | 内容 |
|---|---|
| ✅ | 認証 (メール+パスワード / JWTクッキー / 監査証跡)、オンボーディング初回3ステップ (サンプルデータ→初回診断自動実行)、テナント/クライアント管理 (RLS・俯瞰カード)、ホーム司令室 (検知イベント基盤)、統合ダッシュボード (KPI・トレンド・媒体別・キャンペーンドリルダウン)、AI診断 (指摘ステータス管理付き)、週次レポート (印刷/PDF保存ビュー+BullMQ自動生成 JST月曜7:00)、広告文生成+薬機法/景表法/金商法辞書チェック+媒体別文字数検証、CSV取込 (Shift_JIS/UTF-8自動判別・ヘッダ自動マッピング)、媒体窓口 (付録データ+接続状態)、**異常検知アラート** (ルール4種のしきい値設定・毎時検知+遅延検知・6時間クールダウン・Slack Webhook通知・発生履歴/確認済み管理)、コマンドパレット (⌘K)、LLM原価計測+利用量表示、追記専用監査ログ (audit_trail)、ユニットテスト (vitest) |
| ⬜ | Google SSO / 2FA、Stripe課金、PPTX出力・サーバサイドPDF、媒体API接続 (Phase 2 / 別冊D準拠)、LINE通知 (Messaging API)、承認フロー付き自動適用 (Phase 3) |

## テスト・検証

- `pnpm typecheck` / `pnpm build`
- E2E確認済み: seed→司令室のアラート検出 (CPA急変+56%・CV計測ゼロ)、診断実行→指摘採用の永続化、レポート生成、NG表現 (「痩せる」) のblock検出、SJIS CSV取込、別テナントからのデータ不可視 (RLS)
