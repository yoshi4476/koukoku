# ADGRID API 契約 (MVP)

Base URL: `http://localhost:4000`。DTO の型定義は `@adgrid/shared` (`packages/shared/src/api.ts`) が正。

## 認証

セッションは httpOnly クッキー `adgrid_session` (JWT, 7日)。web からの fetch は必ず `credentials: 'include'` を付ける。
クッキーが無い場合のみ `x-tenant-id` ヘッダ / `DEV_TENANT_ID` にフォールバック (開発用。本番は `ALLOW_TENANT_HEADER=false`)。

| Method | Path | 説明 | レスポンス型 |
|---|---|---|---|
| POST | `/auth/signup` body `{email,password,name,tenantName}` | 登録+テナント作成+ログイン (クッキー設定) | `MeDto` |
| POST | `/auth/login` body `{email,password}` | ログイン (クッキー設定) | `MeDto` |
| POST | `/auth/logout` | ログアウト (クッキー削除) | `{ok:true}` |
| GET | `/auth/me` | セッション確認。未ログインは401 | `MeDto` |
| GET | `/onboarding/status` | オンボーディング要否 | `OnboardingStatusDto` |
| POST | `/onboarding/sample` | サンプルデータ作成+初回診断まで自動実行 | `SampleDataResultDto` |
| POST | `/clients` body `{name, industryCode?}` | クライアント作成 | `ClientDto` |
| POST | `/clients/:clientId/accounts` body `{platform, name?, monthlyBudget?}` | 広告アカウント作成 | `AdAccountDto` |

デモログイン: `demo@adgrid.jp` / `demo-pass-2026` (seed)。

## 業務API

| Method | Path | 説明 | レスポンス型 |
|---|---|---|---|
| GET | `/clients/overview` | クライアント俯瞰 (7日KPI・未対応指摘数・最終レポート日時) | `ClientOverviewDto[]` |
| GET | `/dashboard/campaigns?clientId=&platform=&days=` | キャンペーン別ドリルダウン | `CampaignBreakdownDto[]` |
| GET | `/usage` | 当月のAI利用量・原価 | `UsageDto` |
| GET | `/usage/members` | テナントのメンバー一覧 | `MemberDto[]` |
| POST | `/reports/run-weekly-all` | 週次レポート自動生成の手動トリガ (開発用。cronはJST月曜07:00) | `{generated,skipped,failed}` |
| GET | `/alerts/rules` | アラートルール一覧 (初回アクセスでデフォルト4種を自動作成) | `AlertRuleDto[]` |
| PATCH | `/alerts/rules/:id` body `{threshold?, enabled?, channels?}` | ルール更新 (channels: inapp/slack) | `AlertRuleDto[]` |
| GET | `/alerts/settings` / PUT 同 body `{slackWebhookUrl}` | Slack Webhook設定 | `AlertSettingsDto` |
| POST | `/alerts/settings/test` | Slackテスト送信 (URL未設定は400) | `{ok:true}` |
| POST | `/alerts/run` | 検知の手動実行 (毎時cron+home遅延検知が通常経路) | `AlertRunResultDto` |
| GET | `/alerts/events?limit=` | 発生履歴 (新しい順) | `AlertEventDto[]` |
| POST | `/alerts/events/:id/ack` | イベントを確認済みにする (homeから消える) | `{ok:true}` |
| GET | `/billing` | プラン・アカウント使用数 (上限超過時のアカウント追加は402) | `BillingDto` |
| GET | `/connections` | 媒体API接続一覧 (S-18) | `ConnectionDto[]` |
| POST | `/connections/:platform/authorize` | 認可開始。実API未設定はデモ接続候補を返す。LINEは400 (CSV誘導) | `AuthorizeResultDto` |
| POST | `/connections/:platform/complete` body `{accounts:[{externalAccountId,name,clientId,monthlyBudget?}]}` | 接続確定+アカウント作成+初回30日同期 | `{connection, sync}` |
| POST | `/connections/:id/sync` | 今すぐ同期 (30日洗い替え。3時間毎cronもあり) | `SyncResultDto` |
| DELETE | `/connections/:id` | 切断 (データ・アカウントは保持) | `{ok:true}` |
| GET | `/proposals` | 提案一覧 (pending先頭) | `ProposalDto[]` |
| POST | `/proposals` body `CreateProposalInput` | 提案作成 (シミュレーション自動付与) | `ProposalDto` |
| POST | `/proposals/:id/approve` | 承認→即実行 (owner/adminのみ。kill switch停止中は409)。adjust_budgetは実適用+ロールバック可、他はデモ実行 | `ProposalDto` |
| POST | `/proposals/:id/reject` | 却下 (owner/adminのみ) | `ProposalDto` |
| POST | `/proposals/:id/rollback` | 実行済みadjust_budgetを変更前値に戻す | `ProposalDto` |
| POST | `/proposals/:id/requeue` | 失敗した提案を承認待ちに戻す (再試行) | `ProposalDto` |
| GET/PUT | `/proposals/settings` body `{applyEnabled}` | kill switch (テナント単位の適用停止) | `{applyEnabled}` |
| GET | `/home` | 今日の司令室 (優先度順タスク) | `HomeDto` |
| GET | `/clients` | クライアント一覧 | `ClientDto[]` |
| GET | `/clients/:clientId/accounts` | クライアント配下の広告アカウント | `AdAccountDto[]` |
| GET | `/dashboard?clientId=&platform=&days=7` | 統合ダッシュボード (clientId 省略=全体, platform 省略=全媒体) | `DashboardDto` |
| POST | `/audits/run` body `{ adAccountId }` | AI診断を実行 (モック/実LLM) | `AuditRunDto` |
| GET | `/audits?adAccountId=` | 診断履歴 (新しい順) | `AuditRunDto[]` |
| GET | `/audits/:id` | 診断詳細 | `AuditRunDto` |
| PATCH | `/audits/:id/findings/:rank` body `{ status: 'adopted'\|'dismissed'\|'open' }` | 指摘ステータス更新 | `AuditRunDto` |
| POST | `/reports/run` body `{ clientId, periodType: 'weekly' }` | レポート生成 | `ReportRunDto` |
| GET | `/reports?clientId=` | レポート一覧 | `ReportRunDto[]` |
| POST | `/copies/run` body `{ clientId, platform, productInfo, appealAxes: string[], count }` | 広告文生成+法規制チェック | `CopyRunDto` |
| GET | `/copies?clientId=` | 生成履歴 | `CopyRunDto[]` |
| POST | `/imports/csv` multipart: `file`, fields: `adAccountId` | CSV取込 (Shift_JIS/UTF-8自動判別) | `CsvImportResultDto` |
| GET | `/portal` | 媒体窓口カード一覧 | `PortalCardDto[]` |

## エラー形式

```json
{ "statusCode": 400, "message": "原因を1文で", "resolution": "解決策を1文で" }
```

UI は `message` (原因) と `resolution` (解決策) をセットで表示する (不安を作らない原則)。

## AI実行の注意

- `ANTHROPIC_API_KEY` 未設定時、`/audits/run` `/reports/run` `/copies/run` はモック結果を返す (`mocked: true`)。UIはモックバッジを表示する。
- 実行は同期 (MVP)。/audit は数十秒かかる場合があるため、UIはスケルトン+進捗テキストを表示する。
