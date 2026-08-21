import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors';
import { AuthorizeResult, BaseConnector, DateRange, ExternalAccount, NormalizedRow } from './core';

/**
 * Google広告コネクタ (実API)。別冊D §③ の実装口。
 * 利用には開発者トークン (Basic→Standard審査) と OAuth クライアントが必要:
 *   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN
 * 未設定の間は接続ウィザードがデモ接続 (MockConnector) にフォールバックする。
 */
export class GoogleAdsConnector extends BaseConnector {
  readonly platform = 'google_ads' as const;

  static get configured(): boolean {
    return Boolean(
      process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    );
  }

  async authorize(_tenantId: string): Promise<AuthorizeResult> {
    if (!GoogleAdsConnector.configured) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'Google広告の実API接続はまだ設定されていません。',
        '開発者トークンとOAuthクライアントを取得し GOOGLE_ADS_* 環境変数を設定してください。それまではデモ接続をご利用いただけます。',
      );
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      redirect_uri: `${process.env.API_ORIGIN ?? 'http://localhost:4000'}/connections/google_ads/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent',
    });
    return { mode: 'oauth', authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  async fetchAccounts(_tenantId: string): Promise<ExternalAccount[]> {
    throw this.notImplemented();
  }

  async fetchReport(_externalAccountId: string, _range: DateRange): Promise<NormalizedRow[]> {
    throw this.notImplemented();
  }

  private notImplemented(): AppError {
    return new AppError(
      HttpStatus.NOT_IMPLEMENTED,
      'Google Ads API の呼出実装は認証情報の設定後に有効化されます。',
      '実装仕様 (GAQL searchStream・レート制限・正規化) は別冊「媒体API連携設計」§③に準拠して有効化してください。',
    );
  }
}
