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
