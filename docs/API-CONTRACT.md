# ADGRID API 契約 (MVP)

Base URL: `http://localhost:4000` / 全リクエストに `x-tenant-id: t_demo_agency` ヘッダ (認証実装までの開発用)。
DTO の型定義は `@adgrid/shared` (`packages/shared/src/api.ts`) が正。

| Method | Path | 説明 | レスポンス型 |
|---|---|---|---|
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
