import { HttpStatus } from '@nestjs/common';
import type { Platform } from '@adgrid/shared';
import { AppError } from '../common/errors';

/** 別冊「媒体API連携設計」§① PlatformConnector 準拠 (MVPサブセット) */

export interface DateRange {
  since: string; // YYYY-MM-DD
  until: string;
}

export interface ExternalAccount {
  externalAccountId: string;
  name: string;
}

export interface NormalizedRow {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
}

export interface AuthorizeResult {
  mode: 'mock' | 'oauth';
  candidates?: ExternalAccount[];
  authUrl?: string;
}

// 書込系: requiresApproval をリテラル true にし、承認なしの変更を型で構築不可能にする (Phase 3)
export interface ChangeRequest {
  readonly requiresApproval: true;
  approvalId: string;
  entity: 'campaign' | 'adgroup' | 'ad';
  externalId: string;
  operation: 'update_status' | 'update_budget' | 'update_bid';
  payload: Record<string, unknown>;
}

export interface PlatformConnector {
  readonly platform: Platform;
  authorize(tenantId: string): Promise<AuthorizeResult>;
  fetchAccounts(tenantId: string): Promise<ExternalAccount[]>;
  fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]>;
  applyChange(change: ChangeRequest): Promise<never>;
}

export abstract class BaseConnector implements PlatformConnector {
  abstract readonly platform: Platform;
  abstract authorize(tenantId: string): Promise<AuthorizeResult>;
  abstract fetchAccounts(tenantId: string): Promise<ExternalAccount[]>;
  abstract fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]>;

  /** 書込系はPhase 3の承認フロー実装まで全コネクタで封鎖 (設計書§③ 図3) */
  async applyChange(_change: ChangeRequest): Promise<never> {
    throw new AppError(
      HttpStatus.FORBIDDEN,
      '媒体への書込操作はまだ提供していません。',
      '自動適用 (Phase 3) は承認フローとあわせて提供予定です。提案は手動で媒体管理画面から適用してください。',
    );
  }
}
