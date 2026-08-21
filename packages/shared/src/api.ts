import type { Platform, ConnectionStatus } from './platforms';
import type { AuditResult, FindingStatus, ReportResult, CopyResult } from './ai';

/* ============================================================
 * REST API DTO (apps/api ⇔ apps/web の契約)
 * すべてのリクエストは開発中 `x-tenant-id` ヘッダでテナントを指定する
 * ============================================================ */

/* ---- 認証 ---- */
export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface MeDto {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  role: MemberRole;
}

/* ---- オンボーディング ---- */
export interface OnboardingStatusDto {
  needsOnboarding: boolean;
  clientCount: number;
  hasData: boolean;
  hasAudit: boolean;
}

export interface SampleDataResultDto {
  clientId: string;
  adAccountId: string;
  auditId: string;
}

export interface ClientDto {
  id: string;
  name: string;
  industryCode: string;
  status: 'active' | 'archived';
  accountCount: number;
}

export interface AdAccountDto {
  id: string;
  clientId: string;
  platform: Platform;
  externalAccountId: string;
  name: string;
  currency: string;
  connectionStatus: ConnectionStatus;
  lastSyncedAt: string | null;
}

/** KPIサマリ (期間合計 + 前期比) */
export interface KpiSummaryDto {
  cost: number;
  conversions: number;
  cpa: number | null;
  roas: number | null;
  clicks: number;
  impressions: number;
  /** 前期比 (%表記の数値, 例 +5.2)。前期データなしは null */
  deltas: {
    cost: number | null;
    conversions: number | null;
    cpa: number | null;
    roas: number | null;
  };
}

export interface DailyPointDto {
  date: string; // YYYY-MM-DD
  cost: number;
  conversions: number;
}

export interface PlatformBreakdownDto {
  platform: Platform;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  cpaDelta: number | null;
}

export interface DashboardDto {
  period: { since: string; until: string };
  kpi: KpiSummaryDto;
  trend: { current: DailyPointDto[]; previous: DailyPointDto[] };
  byPlatform: PlatformBreakdownDto[];
}

/* ---- ホーム (今日の司令室) ---- */
export type TaskKind = 'alert' | 'ai_proposal' | 'approval' | 'report';
export type TaskSeverity = 'bad' | 'warn' | 'ai' | 'ok' | 'neutral';

export interface HomeTaskDto {
  id: string;
  kind: TaskKind;
  severity: TaskSeverity;
  title: string;
  subtitle: string;
  clientName: string;
  platform: Platform | null;
  href: string;
}

export interface HomeDto {
  date: string;
  doneCount: number;
  totalCount: number;
  tasks: HomeTaskDto[];
}

/* ---- AI 実行結果 ---- */
export interface AuditRunDto {
  id: string;
  adAccountId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  mocked: boolean;
  result: AuditResult;
  findingStatuses: Record<number, FindingStatus>; // priority_rank -> status
}

export interface ReportRunDto {
  id: string;
  clientId: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
  createdAt: string;
  promptVersion: string;
  mocked: boolean;
  result: ReportResult;
}

export interface CopyRunDto {
  id: string;
  clientId: string;
  platform: Platform;
  createdAt: string;
  promptVersion: string;
  mocked: boolean;
  input: { productInfo: string; appealAxes: string[]; count: number };
  result: CopyResult;
  /** プログラム検証: 媒体別文字数制限の結果 */
  lengthChecks: Array<{ index: number; headlineOk: boolean; descriptionOk: boolean }>;
}

/* ---- CSV取込 ---- */
export interface CsvImportResultDto {
  importId: string;
  detectedFormat: string;
  encoding: 'utf8' | 'sjis';
  rowCount: number;
  insertedRows: number;
  errorRows: number;
  mapping: Record<string, string>;
  warnings: string[];
}

/* ---- クライアント管理 ---- */
export interface ClientOverviewDto {
  client: ClientDto;
  cost7d: number;
  conversions7d: number;
  cpa7d: number | null;
  cpaDelta: number | null;
  openFindings: number;
  lastReportAt: string | null;
}

export interface CampaignBreakdownDto {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  cpaDelta: number | null;
}

/* ---- 設定 ---- */
export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
}

export interface UsageDto {
  monthCostJpy: number;
  monthCallCount: number;
  byFeature: Array<{ feature: string; costJpy: number; count: number }>;
  mockedNote: boolean;
}

/* ---- アラート (F-13) ---- */
export type AlertMetric = 'budget_pace' | 'cpa_spike' | 'cv_zero' | 'spend_drop';
export type AlertChannel = 'inapp' | 'slack';

export interface AlertRuleDto {
  id: string;
  metric: AlertMetric;
  threshold: number;
  enabled: boolean;
  channels: AlertChannel[];
}

export interface AlertEventDto {
  id: string;
  metric: AlertMetric;
  severity: 'bad' | 'warn';
  title: string;
  body: string;
  clientName: string;
  accountName: string;
  platform: Platform;
  adAccountId: string;
  firedAt: string;
  notified: boolean;
  acked: boolean;
}

export interface AlertSettingsDto {
  slackWebhookUrl: string;
}

export interface AlertRunResultDto {
  fired: number;
  suppressed: number;
  notified: number;
}

/* ---- プラン (要件書 §⑦。課金処理はStripe接続後) ---- */
export type PlanId = 'starter' | 'business' | 'agency' | 'enterprise';

export interface PlanDef {
  id: PlanId;
  label: string;
  monthlyPriceJpy: number | null; // null = 個別見積
  accountLimit: number | null; // null = 無制限
  seatLimit: number | null;
}

export const PLANS: Record<PlanId, PlanDef> = {
  starter: { id: 'starter', label: 'Starter', monthlyPriceJpy: 29800, accountLimit: 5, seatLimit: 3 },
  business: { id: 'business', label: 'Business', monthlyPriceJpy: 98000, accountLimit: 20, seatLimit: 10 },
  agency: { id: 'agency', label: 'Agency', monthlyPriceJpy: 298000, accountLimit: 75, seatLimit: 30 },
  enterprise: { id: 'enterprise', label: 'Enterprise', monthlyPriceJpy: null, accountLimit: null, seatLimit: null },
};

export interface BillingDto {
  plan: PlanDef;
  accountsUsed: number;
  accountLimit: number | null;
  /** Stripe未接続の間は常にtrial扱い */
  billingConfigured: boolean;
}

/* ---- 媒体API接続 (S-18 / 別冊D) ---- */
export interface ConnectionDto {
  id: string;
  platform: Platform;
  status: ConnectionStatus;
  mode: 'mock' | 'oauth';
  lastSyncedAt: string | null;
  lastSyncRows: number;
  errorMessage: string;
  accountCount: number;
}

export interface AuthorizeResultDto {
  mode: 'mock' | 'oauth';
  /** mock: 接続候補アカウント一覧を即時返す */
  candidates?: Array<{ externalAccountId: string; name: string }>;
  /** oauth: 媒体認可画面URL (実API認証情報の設定後に有効) */
  authUrl?: string;
}

export interface SyncResultDto {
  rows: number;
  since: string;
  until: string;
}

/* ---- 媒体窓口 ---- */
export interface PortalCardDto {
  platform: Platform;
  label: string;
  brandColor: string;
  adminUrl: string;
  helpUrl: string;
  developerUrl: string;
  apiAvailability: 'oauth' | 'access_key' | 'partner_only';
  connectionStatus: ConnectionStatus;
  lastSyncedAt: string | null;
  accountCount: number;
}
