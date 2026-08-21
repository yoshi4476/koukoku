/** 媒体識別子 (プロンプトD準拠) */
export type Platform =
  | 'google_ads'
  | 'yahoo_search'
  | 'yahoo_display'
  | 'meta'
  | 'line_ads'
  | 'tiktok'
  | 'x_ads'
  | 'microsoft_ads'
  | 'amazon_ads'
  | 'smartnews_ads'
  | 'criteo'
  | 'pinterest';

export type ConnectionStatus = 'connected' | 'needs_reauth' | 'error' | 'not_connected';

export interface PlatformMeta {
  platform: Platform;
  label: string;
  /** タグ・アイコン限定使用 (デザインシステム準拠) */
  brandColor: string;
  /** API接続の提供状況。LINE は認定パートナー限定のため CSV 連携で代替 */
  apiAvailability: 'oauth' | 'access_key' | 'partner_only';
  adminUrl: string;
  helpUrl: string;
  developerUrl: string;
}

/** 付録「媒体窓口クイックアクセス集」のマスタデータ (2026年時点。リンク切れチェックを日次で実施) */
export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  google_ads: {
    platform: 'google_ads',
    label: 'Google広告',
    brandColor: '#4285F4',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads.google.com',
    helpUrl: 'https://support.google.com/google-ads',
    developerUrl: 'https://developers.google.com/google-ads/api',
  },
  yahoo_search: {
    platform: 'yahoo_search',
    label: 'Yahoo!広告 (検索)',
    brandColor: '#FF0033',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads-promo.yahoo.co.jp',
    helpUrl: 'https://ads-help.yahoo.co.jp',
    developerUrl: 'https://ads-developers.yahoo.co.jp',
  },
  yahoo_display: {
    platform: 'yahoo_display',
    label: 'Yahoo!広告 (ディスプレイ)',
    brandColor: '#FF0033',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads-promo.yahoo.co.jp',
    helpUrl: 'https://ads-help.yahoo.co.jp',
    developerUrl: 'https://ads-developers.yahoo.co.jp',
  },
  meta: {
    platform: 'meta',
    label: 'Meta広告',
    brandColor: '#0866FF',
    apiAvailability: 'oauth',
    adminUrl: 'https://adsmanager.facebook.com',
    helpUrl: 'https://www.facebook.com/business/help',
    developerUrl: 'https://developers.facebook.com/docs/marketing-apis',
  },
  line_ads: {
    platform: 'line_ads',
    label: 'LINE広告',
    brandColor: '#06C755',
    apiAvailability: 'partner_only',
    adminUrl: 'https://admanager.line.biz',
    helpUrl: 'https://www.linebiz.com',
    developerUrl: 'https://developers.line.biz',
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok広告',
    brandColor: '#131F35',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads.tiktok.com',
    helpUrl: 'https://ads.tiktok.com/help',
    developerUrl: 'https://business-api.tiktok.com/portal',
  },
  x_ads: {
    platform: 'x_ads',
    label: 'X広告',
    brandColor: '#131F35',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads.x.com',
    helpUrl: 'https://business.x.com/help',
    developerUrl: 'https://developer.x.com',
  },
  microsoft_ads: {
    platform: 'microsoft_ads',
    label: 'Microsoft広告',
    brandColor: '#00A4EF',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads.microsoft.com',
    helpUrl: 'https://about.ads.microsoft.com',
    developerUrl: 'https://learn.microsoft.com/advertising',
  },
  amazon_ads: {
    platform: 'amazon_ads',
    label: 'Amazon Ads',
    brandColor: '#E47911',
    apiAvailability: 'oauth',
    adminUrl: 'https://advertising.amazon.com',
    helpUrl: 'https://advertising.amazon.com',
    developerUrl: 'https://advertising.amazon.com/API/docs',
  },
  smartnews_ads: {
    platform: 'smartnews_ads',
    label: 'SmartNews Ads',
    brandColor: '#E64A19',
    apiAvailability: 'partner_only',
    adminUrl: 'https://partners.smartnews-ads.com',
    helpUrl: 'https://ads-help.smartnews.com',
    developerUrl: 'https://partners.smartnews-ads.com',
  },
  criteo: {
    platform: 'criteo',
    label: 'Criteo',
    brandColor: '#FF6D2D',
    apiAvailability: 'oauth',
    adminUrl: 'https://marketing.criteo.com',
    helpUrl: 'https://help.criteo.com',
    developerUrl: 'https://developers.criteo.com',
  },
  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest広告',
    brandColor: '#E60023',
    apiAvailability: 'oauth',
    adminUrl: 'https://ads.pinterest.com',
    helpUrl: 'https://help.pinterest.com/business',
    developerUrl: 'https://developers.pinterest.com',
  },
};

export const ALL_PLATFORMS = Object.keys(PLATFORM_META) as Platform[];
