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

export interface ApplyResult {
  success: boolean;
  note: string;
  simulated: boolean;
}

export interface PlatformConnector {
  readonly platform: Platform;
  authorize(tenantId: string): Promise<AuthorizeResult>;
  fetchAccounts(tenantId: string): Promise<ExternalAccount[]>;
  fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]>;
  applyChange(change: ChangeRequest): Promise<ApplyResult>;
}

export abstract class BaseConnector implements PlatformConnector {
  abstract readonly platform: Platform;
  abstract authorize(tenantId: string): Promise<AuthorizeResult>;
  abstract fetchAccounts(tenantId: string): Promise<ExternalAccount[]>;
  abstract fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]>;

  /** 書込系の共通ガード: 承認済み提案ID (approvalId) なしの実行は構造的に不可 (設計書§③ 図3) */
  async applyChange(change: ChangeRequest): Promise<ApplyResult> {
    if (!change.requiresApproval || !change.approvalId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '承認されていない変更は実行できません。',
        '承認キューで承認された提案のみ媒体へ適用されます。',
      );
    }
    return this.doApplyChange(change);
  }

  protected doApplyChange(_change: ChangeRequest): Promise<ApplyResult> {
    return Promise.reject(
      new AppError(
        HttpStatus.NOT_IMPLEMENTED,
        'この媒体への書込はまだ実装されていません。',
        '実API認証情報の設定後、別冊D準拠で有効化されます。',
      ),
    );
  }
}
