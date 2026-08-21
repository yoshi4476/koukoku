import type { Platform, ConnectionStatus } from './platforms';
import type { AuditResult, FindingStatus, ReportResult, CopyResult } from './ai';

/* ============================================================
 * REST API DTO (apps/api ⇔ apps/web の契約)
 * すべてのリクエストは開発中 `x-tenant-id` ヘッダでテナントを指定する
 * ============================================================ */

/* ---- 認証 ---- */
export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer';

/** 承認・実行・自動適用設定を操作できるロール (フロント/バックで共有) */
export function isApprover(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

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

/* ---- カスタムダッシュボード (B-5) ---- */
export type WidgetMetric = 'cost' | 'conversions' | 'cpa' | 'roas' | 'clicks' | 'impressions' | 'ctr' | 'cvr';
export type WidgetDimension = 'none' | 'platform' | 'client' | 'date';
export type WidgetType = 'stat' | 'bar' | 'line' | 'table';

export interface WidgetDef {
  id: string;
  type: WidgetType;
  title: string;
  metric: WidgetMetric;
  /** stat以外で使う集計軸 */
  dimension: WidgetDimension;
  /** グリッド幅 (1=1/3, 2=2/3, 3=全幅) */
  width: 1 | 2 | 3;
  /** 期間 (日数) */
  days: number;
  clientId?: string;
}

export interface DashboardDef {
  id: string;
  name: string;
  isDefault: boolean;
  layout: WidgetDef[];
  updatedAt: string;
}

export interface DashboardListDto {
  dashboards: Array<{ id: string; name: string; isDefault: boolean; widgetCount: number }>;
}

/** ウィジェット1個のデータ (集約結果) */
export interface WidgetDataDto {
  widgetId: string;
  metric: WidgetMetric;
  /** stat: 単一値+前期比 / bar・line・table: ラベル付き系列 */
  stat?: { value: number; delta: number | null };
  series?: Array<{ label: string; value: number }>;
  unit: 'yen' | 'count' | 'percent' | 'ratio';
}

export const WIDGET_METRIC_LABEL: Record<WidgetMetric, string> = {
  cost: '消化額',
  conversions: 'CV',
  cpa: 'CPA',
  roas: 'ROAS',
  clicks: 'クリック',
  impressions: '表示回数',
  ctr: 'CTR',
  cvr: 'CVR',
};

export const WIDGET_METRIC_UNIT: Record<WidgetMetric, WidgetDataDto['unit']> = {
  cost: 'yen', conversions: 'count', cpa: 'yen', roas: 'percent',
  clicks: 'count', impressions: 'count', ctr: 'percent', cvr: 'percent',
};

/* ---- 変更履歴 (B-2 / F-15) ---- */
export interface ChangeLogDto {
  id: string;
  adAccountId: string;
  accountName: string;
  clientName: string;
  platform: Platform;
  changedAt: string;
  actor: 'adgrid' | 'media_console' | 'api';
  actorName: string;
  entity: string;
  field: string;
  oldValue: string;
  newValue: string;
  note: string;
}

/* ---- 勝ちパターン資産集 (B-1 / F-17) ---- */
export type KnowledgeObjective = 'conversion' | 'awareness' | 'traffic';

export interface KnowledgeAssetDto {
  id: string;
  scope: 'own' | 'shared'; // own=自社ナレッジ / shared=匿名共有
  industryCode: string;
  industryLabel: string;
  objective: KnowledgeObjective;
  appealAxis: string;
  creativeSummary: string;
  platform: string;
  winRate: number; // 0-1
  sampleSize: number;
  liftPct: number | null;
  createdAt: string;
}

export interface KnowledgeSearchDto {
  own: KnowledgeAssetDto[];
  shared: KnowledgeAssetDto[];
}

export interface PromoteAbTestInput {
  abTestId: string;
  objective?: KnowledgeObjective;
  appealAxis: string;
  creativeSummary: string;
  /** 匿名化して共有ナレッジにも登録する (オプトイン) */
  shareAnonymized?: boolean;
}

/* ---- 確信度較正 (A-4) ---- */
export interface CalibrationDto {
  category: string;
  categoryLabel: string;
  adopted: number;
  dismissed: number;
  adoptionRate: number | null; // 採用率 0-1
  /** この較正がもたらす確信度への影響 (boost/neutral/penalty) */
  effect: 'boost' | 'neutral' | 'penalty' | 'insufficient';
}

/* ---- 予算ペーシング予測 (B-4) ---- */
export interface PacingDto {
  adAccountId: string;
  accountName: string;
  clientName: string;
  platform: Platform;
  monthlyBudget: number;
  monthToDateCost: number;
  /** 現ペースでの月末着地予測額 */
  projectedMonthEnd: number;
  /** 予算に対する着地予測% */
  projectedPct: number;
  /** 予算内に着地させる推奨日予算 */
  recommendedDailyBudget: number;
  currentDailyAvg: number;
  status: 'over' | 'under' | 'on_track';
  /** 予算に到達/枯渇する予測日 (YYYY-MM-DD、しない場合null) */
  runOutDate: string | null;
  daysLeft: number;
}

/* ---- 業種別ベンチマーク (A-3) ---- */
export interface BenchmarkDto {
  industryCode: string;
  industryLabel: string;
  metrics: {
    ctr: { value: number | null; benchmark: number; verdict: 'good' | 'avg' | 'poor' | 'na' };
    cvr: { value: number | null; benchmark: number; verdict: 'good' | 'avg' | 'poor' | 'na' };
    cpa: { value: number | null; benchmark: number; verdict: 'good' | 'avg' | 'poor' | 'na' };
  };
}

/* ---- A/Bテスト管理 (B-3) ---- */
export interface AbArmInput {
  label: string;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AbTestDto {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  hypothesis: string;
  metric: 'cvr' | 'ctr';
  status: 'running' | 'concluded';
  a: { label: string; impressions: number; clicks: number; conversions: number; rate: number | null };
  b: { label: string; impressions: number; clicks: number; conversions: number; rate: number | null };
  /** 統計的検定の結果 */
  result: {
    /** 勝者 (有意差ありの場合のみ a/b、なければ none) */
    winner: 'a' | 'b' | 'none';
    /** 相対リフト% (Bの対Aの改善率) */
    lift: number | null;
    /** p値 (two-proportion z-test) */
    pValue: number | null;
    significant: boolean;
    /** サンプルが十分か */
    enoughData: boolean;
    summary: string;
  };
  createdAt: string;
}

export interface CreateAbTestInput {
  clientId: string;
  name: string;
  hypothesis?: string;
  metric?: 'cvr' | 'ctr';
  a: AbArmInput;
  b: AbArmInput;
}

/* ---- 承認フロー付き適用 (F-16 / Phase 3) ---- */
export type ProposalAction = 'adjust_budget' | 'adjust_bid' | 'pause_campaign';
export type ProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'rolled_back';

export interface ProposalDto {
  id: string;
  adAccountId: string;
  accountName: string;
  clientName: string;
  platform: Platform;
  actionType: ProposalAction;
  actionPayload: Record<string, unknown>;
  title: string;
  evidence: string;
  risk: string;
  confidence: 'high' | 'mid' | 'low';
  simulation: string;
  status: ProposalStatus;
  executionNote: string;
  /** ロールバック可能 (実適用され変更前値を保持している場合のみ) */
  canRollback: boolean;
  createdAt: string;
  approvedAt: string | null;
  executedAt: string | null;
}

export interface CreateProposalInput {
  adAccountId: string;
  actionType: ProposalAction;
  /** adjust_budget: {newMonthlyBudget} / adjust_bid: {campaignId, percent} / pause_campaign: {campaignId} */
  actionPayload: Record<string, unknown>;
  title: string;
  evidence?: string;
  risk?: string;
  confidence?: 'high' | 'mid' | 'low';
  sourceAuditId?: string;
  sourceRank?: number;
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
