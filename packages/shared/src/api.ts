import type { Platform, ConnectionStatus } from './platforms';
import type { AuditResult, FindingStatus, ReportResult, CopyResult } from './ai';

/* ============================================================
 * REST API DTO (apps/api ⇔ apps/web の契約)
 * すべてのリクエストは開発中 `x-tenant-id` ヘッダでテナントを指定する
 * ============================================================ */

/* ---- 認証 ---- */
// client = 提供先(他社)アクセス。1クライアントのデータのみ閲覧できる限定ユーザー
export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer' | 'client';

/** 承認・実行・自動適用設定を操作できるロール (フロント/バックで共有) */
export function isApprover(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

/* ---- 版 (edition) ---- */
// agency=自社運用版(全機能) / client=提供先版(自社データ閲覧中心・運用操作は非表示)
export type Edition = 'agency' | 'client';

export const EDITION_LABEL: Record<Edition, string> = {
  agency: '自社運用版',
  client: '提供先版',
};

/** 版ごとに使える機能。client版は「自分のデータ閲覧」中心で、承認・自動適用・
 *  媒体接続や課金などの運用/管理機能を隠す。ナビ絞り込みとサーバ側ガードで二重に効かせる */
export type EditionFeature =
  | 'approvals' // 承認キュー
  | 'autoApply' // 自動適用/キルスイッチ
  | 'connections' // 媒体API接続の管理
  | 'billing' // プラン・課金
  | 'members' // メンバー管理
  | 'imports' // CSV取込
  | 'knowledge'; // 勝ちパターン資産集 (テナント横断ナレッジ)

const CLIENT_HIDDEN: ReadonlySet<EditionFeature> = new Set<EditionFeature>([
  'approvals',
  'autoApply',
  'connections',
  'billing',
  'members',
  'imports',
  'knowledge',
]);

/** 版 edition が feature を使えるか。agencyは全許可、clientは運用/管理系を不可 */
export function editionAllows(edition: Edition, feature: EditionFeature): boolean {
  if (edition === 'agency') return true;
  return !CLIENT_HIDDEN.has(feature);
}

export interface MeDto {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  role: MemberRole;
  edition: Edition;
  /** 提供先(client)アクセスの場合、閲覧を許可された唯一のクライアントID (それ以外は null) */
  clientScopeId: string | null;
  clientScopeName: string | null;
}

/* ---- 提供先アクセス発行 (F-22) ---- */
export interface ClientAccessDto {
  userId: string;
  email: string;
  name: string;
  clientId: string;
  createdAt: string;
}
export interface CreateClientAccessInput {
  email: string;
  password: string;
  name?: string;
}

/* ---- フィードバック (提供先→自社) ---- */
export interface FeedbackDto {
  id: string;
  clientId: string;
  clientName: string;
  authorName: string;
  projectId: string | null;
  message: string;
  status: 'open' | 'resolved';
  createdAt: string;
}
export interface CreateFeedbackInput {
  message: string;
  projectId?: string;
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
export type AlertMetric =
  | 'budget_pace'
  | 'cpa_spike'
  | 'cv_zero'
  | 'spend_drop'
  // AIアドバイザー: 「変更したほうがいい」「不備」を先回りで検知
  | 'benchmark_gap' // 業種相場から大きく乖離 (改善余地)
  | 'roas_low' // ROASが目標/相場を大きく下回る
  | 'no_recent_audit'; // 一定期間AI診断が実行されていない (不備)
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

/* ---- プロジェクト (F-19) ---- */
export type ProjectGoal = 'conversion' | 'awareness' | 'traffic' | 'store';
export type ProjectStatus = 'active' | 'paused' | 'ended';

export const PROJECT_GOAL_LABEL: Record<ProjectGoal, string> = {
  conversion: '獲得 (CV)',
  awareness: '認知',
  traffic: '誘導',
  store: '来店・予約',
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '配信中',
  paused: '一時停止',
  ended: '終了',
};

/** プロジェクト一覧の1件。掲示・推移・アラート・改善の要約を1枚に集約 */
export interface ProjectDto {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  industryCode: string;
  goal: ProjectGoal;
  status: ProjectStatus;
  note: string;
  accountCount: number;
  platforms: Platform[];
  cost7d: number;
  conversions7d: number;
  cpa7d: number | null;
  cpaDelta: number | null;
  alertCount: number;
  openFindings: number;
  assetCount: number;
  publishedCount: number;
  lastReportAt: string | null;
  createdAt: string;
}

/** プロジェクト内の1媒体アカウント (掲示タブ) */
export interface ProjectAccountDto {
  adAccountId: string;
  name: string;
  platform: Platform;
  connectionStatus: ConnectionStatus;
  monthlyBudget: number | null;
  cost7d: number;
  conversions7d: number;
  cpa7d: number | null;
}

export interface ProjectDetailDto {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  industryCode: string;
  goal: ProjectGoal;
  status: ProjectStatus;
  note: string;
  kpi: KpiSummaryDto;
  trend: DailyPointDto[];
  accounts: ProjectAccountDto[];
  alerts: AlertEventDto[];
  openFindings: number;
  assets: ProjectAssetDto[];
  settings: ProjectSettings;
  brief: ProjectBrief;
  kpiProgress: KpiProgressDto;
  lastReportAt: string | null;
  createdAt: string;
}

/* ---- 目標(KPI)と進捗 (F-21) ---- */
export type PaceStatus = 'ahead' | 'ontrack' | 'behind' | 'none';
export interface KpiProgressDto {
  daysElapsed: number;
  daysInMonth: number;
  cv: { target: number | null; actual: number; projected: number; pct: number | null; status: PaceStatus };
  cpa: { target: number | null; actual: number | null; status: 'good' | 'warn' | 'bad' | 'none' };
  spend: { budget: number | null; actual: number; projected: number; pct: number | null };
}

export const PACE_STATUS_LABEL: Record<PaceStatus, string> = {
  ahead: '目標超過ペース',
  ontrack: '順調',
  behind: '未達ペース',
  none: '目標未設定',
};

/* ---- 週次AIインサイト (F-21) ---- */
export type InsightSeverity = 'critical' | 'opportunity' | 'info';
export interface InsightItemDto {
  severity: InsightSeverity;
  title: string;
  detail: string;
  projectId: string | null;
  projectName: string | null;
  href: string;
}
export interface InsightDigestDto {
  headline: string;
  items: InsightItemDto[];
}

/* ---- 媒体審査シミュレーション (F-21) ---- */
export type ReviewVerdict = 'pass' | 'caution' | 'risk';
export interface ReviewIssueDto {
  severity: 'block' | 'warn';
  scope: string; // 景表法 / 薬機法 / 媒体共通 / 業種規制 等
  expression: string;
  reason: string;
  suggestion: string;
}
export interface ReviewSimDto {
  assetId: string;
  verdict: ReviewVerdict;
  issues: ReviewIssueDto[];
  note: string;
}
export const REVIEW_VERDICT_META: Record<ReviewVerdict, { label: string; cls: string }> = {
  pass: { label: '通過見込み', cls: 'up' },
  caution: { label: '要修正', cls: 'warn' },
  risk: { label: '却下リスク高', cls: 'down' },
};

export interface CreateProjectInput {
  clientId: string;
  name: string;
  goal?: ProjectGoal;
  note?: string;
  accountIds?: string[];
}

/* 配信設定 (予算・入札・ターゲティング・期間・計測) */
export type BidStrategy =
  | 'maximize_conversions'
  | 'target_cpa'
  | 'target_roas'
  | 'maximize_clicks'
  | 'manual';

export const BID_STRATEGY_LABEL: Record<BidStrategy, string> = {
  maximize_conversions: 'コンバージョン数の最大化',
  target_cpa: '目標CPA',
  target_roas: '目標ROAS',
  maximize_clicks: 'クリック数の最大化',
  manual: '個別クリック単価 (手動)',
};

export interface ProjectSettings {
  /** 月予算の合計 (円) */
  monthlyBudgetTotal: number | null;
  /** 日予算の目安 (円) */
  dailyBudget: number | null;
  /** 目標CPA (円) */
  targetCpa: number | null;
  /** 目標ROAS (%) */
  targetRoas: number | null;
  /** 目標CV数 (件/月) */
  targetCv: number | null;
  bidStrategy: BidStrategy;
  /** 配信開始日 YYYY-MM-DD */
  startDate: string | null;
  /** 配信終了日 YYYY-MM-DD (無期限は null) */
  endDate: string | null;
  /** 対象地域 (例: 全国 / 東京・神奈川) */
  regions: string;
  /** 年齢層 (例: 25-44) */
  ageRange: string;
  gender: 'all' | 'male' | 'female';
  devices: 'all' | 'mobile' | 'desktop';
  /** 計測するCV地点 (例: 購入完了 / 資料請求) */
  conversionPoint: string;
  /** 配信時間帯 (例: 終日 / 平日9-18時) */
  dayparting: string;
  note: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  monthlyBudgetTotal: null,
  dailyBudget: null,
  targetCpa: null,
  targetRoas: null,
  targetCv: null,
  bidStrategy: 'maximize_conversions',
  startDate: null,
  endDate: null,
  regions: '全国',
  ageRange: '指定なし',
  gender: 'all',
  devices: 'all',
  conversionPoint: '',
  dayparting: '終日',
  note: '',
};

/* ヒアリングシート (成果の土台。しっかり記入するほど広告文・打ち出し方の精度が上がる) */
export interface ProjectBrief {
  business: string; // 事業内容
  product: string; // 商材・サービスの内容
  usp: string; // 強み・他社との違い (USP)
  targetPersona: string; // ターゲット顧客像
  painPoint: string; // 顧客の悩み・課題
  offer: string; // 特典・オファー・保証
  reasonToChoose: string; // 選ばれる理由・実績
  competitors: string; // 競合
  area: string; // 提供エリア
  ngItems: string; // NG・言えないこと・規制事項
  reference: string; // 参考LP・事例URL
  note: string; // その他
}

export const DEFAULT_PROJECT_BRIEF: ProjectBrief = {
  business: '', product: '', usp: '', targetPersona: '', painPoint: '', offer: '',
  reasonToChoose: '', competitors: '', area: '', ngItems: '', reference: '', note: '',
};

/** 成果に効く重要項目 (記入率の分母/優先案内に使う) */
export const BRIEF_KEY_FIELDS: (keyof ProjectBrief)[] = [
  'business', 'product', 'usp', 'targetPersona', 'painPoint', 'offer', 'reasonToChoose',
];

export interface BriefCompleteness {
  filled: number;
  total: number;
  pct: number;
  missing: (keyof ProjectBrief)[];
}

export function briefCompleteness(brief: Partial<ProjectBrief>): BriefCompleteness {
  const missing = BRIEF_KEY_FIELDS.filter((k) => !((brief[k] ?? '').toString().trim()));
  const filled = BRIEF_KEY_FIELDS.length - missing.length;
  return {
    filled,
    total: BRIEF_KEY_FIELDS.length,
    pct: Math.round((filled / BRIEF_KEY_FIELDS.length) * 100),
    missing,
  };
}

export interface UpdateProjectInput {
  name?: string;
  goal?: ProjectGoal;
  status?: ProjectStatus;
  note?: string;
  accountIds?: string[];
  settings?: Partial<ProjectSettings>;
  brief?: Partial<ProjectBrief>;
}

/* 制作物の改善アドバイス (公開後の改善ポイント) */
export interface AssetAdviceItem {
  title: string;
  detail: string;
  severity: 'good' | 'tip' | 'warn';
}
export interface AssetAdviceDto {
  assetId: string;
  type: AssetType;
  /** 現状の良い点・改善余地の総評 (1行) */
  summary: string;
  items: AssetAdviceItem[];
}

/* ---- プロジェクトの制作物 (広告文/LP/チラシ/動画) ---- */
export type AssetType = 'copy' | 'lp' | 'flyer' | 'video';
export type AssetStatus = 'draft' | 'review' | 'approved' | 'published';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  copy: '広告文',
  lp: 'LP (ランディングページ)',
  flyer: 'チラシ',
  video: '動画',
};

export const ASSET_TYPE_ICON: Record<AssetType, string> = {
  copy: '📝',
  lp: '🖥️',
  flyer: '🖼️',
  video: '🎬',
};

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  draft: '下書き',
  review: 'レビュー中',
  approved: '承認済み',
  published: '公開中',
};

export interface ProjectAssetDto {
  id: string;
  projectId: string;
  type: AssetType;
  title: string;
  /** copy=本文 / その他=説明 */
  content: string;
  /** LP・動画・チラシのリンク or 画像URL */
  url: string;
  status: AssetStatus;
  note: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface CreateAssetInput {
  type: AssetType;
  title: string;
  content?: string;
  url?: string;
  note?: string;
}

export interface UpdateAssetInput {
  title?: string;
  content?: string;
  url?: string;
  status?: AssetStatus;
  note?: string;
}

/* ---- 予算の最適配分 (F-20) ---- */
export interface BudgetPlanItemDto {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  monthlyCost: number;
  conversions: number;
  cpa: number | null;
  action: 'increase' | 'decrease' | 'keep';
  /** 推奨する月額の増減 (円、符号付き) */
  recommendedChange: number;
  reason: string;
}
export interface BudgetPlanDto {
  totalMonthly: number;
  /** 非効率キャンペーンから捻出できる月額 */
  reallocatable: number;
  /** 再配分で見込めるCV増 (件/月) */
  expectedCvGain: number;
  items: BudgetPlanItemDto[];
  note: string;
}

/* ---- クリエイティブ疲弊検知 (F-20) ---- */
export type FatigueLevel = 'ok' | 'watch' | 'fatigued';
export interface FatigueItemDto {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  impressionsRecent: number;
  ctrRecent: number | null;
  ctrPrior: number | null;
  ctrDeltaPct: number | null;
  cvrRecent: number | null;
  cvrPrior: number | null;
  level: FatigueLevel;
  recommendation: string;
}
export interface FatigueReportDto {
  items: FatigueItemDto[];
  fatiguedCount: number;
  watchCount: number;
}

/* ---- キーワード発見・拡張 (F-20) ---- */
export type KeywordKind = 'brand' | 'generic' | 'longtail' | 'competitor' | 'local' | 'purchase';
export type VolumeBucket = 'low' | 'mid' | 'high';
export const VOLUME_LABEL: Record<VolumeBucket, string> = { low: '小', mid: '中', high: '大' };
export const KEYWORD_KIND_LABEL: Record<KeywordKind, string> = {
  brand: '指名',
  generic: '一般',
  longtail: 'ロングテール',
  competitor: '競合',
  local: '地域',
  purchase: '購買意欲',
};
export interface KeywordSuggestionDto {
  keyword: string;
  matchType: 'exact' | 'phrase' | 'broad';
  kind: KeywordKind;
  estimatedVolume: VolumeBucket;
  estimatedCpc: number;
  priority: 'high' | 'mid' | 'low';
  rationale: string;
}
export interface KeywordDiscoveryDto {
  industryLabel: string;
  suggestions: KeywordSuggestionDto[];
}

/* ---- キーワード最適化 (F-18) ---- */
/** 各キーワードへの推奨アクション。増額/維持/減額/停止 */
export type KeywordAction = 'increase' | 'keep' | 'decrease' | 'pause';

export interface KeywordRowDto {
  id: string;
  keyword: string;
  matchType: 'exact' | 'phrase' | 'broad';
  platform: Platform;
  clientId: string;
  clientName: string;
  adAccountId: string;
  accountName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  currentBid: number | null;
  qualityScore: number | null;
  /* 算出指標 */
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  cvr: number | null;
  roas: number | null;
  /** 投資対効果 (回収額-費用)/費用 = ROI%。conversionValue 未計測時 null */
  roi: number | null;
  /** 総合効率スコア 0-100 (CTR/CVR/CPA/ROAS を業種相場で正規化した合成値) */
  efficiency: number;
  /* 推奨 */
  action: KeywordAction;
  /** 推奨後の入札額 (currentBid が既知の場合)。未知なら null */
  recommendedBid: number | null;
  /** 推奨する予算/入札の増減率 (例 +30, -50)。維持は 0 */
  bidChangePct: number;
  /** なぜこの推奨か (1行) */
  reason: string;
  /** 期待効果 (1行) */
  expectedImpact: string;
}

/** ランキング枠 (最高CTR / バランス最良 / 最高ROI) の1エントリ */
export interface KeywordRankItemDto {
  keyword: string;
  clientName: string;
  platform: Platform;
  /** そのランキングの主要指標の表示値 (例 "CTR 8.2%") */
  metricLabel: string;
  metricValue: number;
  note: string;
}

export interface KeywordOptimizeDto {
  /** 分析対象キーワード総数 */
  totalKeywords: number;
  /** 集計期間の日数 */
  windowDays: number;
  /** 業種モードのラベル (相場基準に使用) */
  industryLabel: string;
  /* 3つの算出ランキング */
  topCtr: KeywordRankItemDto[];
  bestBalance: KeywordRankItemDto[];
  topRoi: KeywordRankItemDto[];
  /* 予算配分の提案サマリ */
  summary: {
    increaseCount: number;
    decreaseCount: number;
    pauseCount: number;
    /** 減額/停止で浮く推定月額 (円) */
    reclaimableBudget: number;
    /** 増額推奨に再配分した場合の期待CV増分 (件/月) */
    projectedCvGain: number;
  };
  rows: KeywordRowDto[];
}
