import type { Platform, ConnectionStatus, MemberRole } from '@adgrid/shared';

/* 媒体色はダークモードで反転するため hex ではなく CSS 変数で参照する */
export const PLATFORM_COLOR_VAR: Record<Platform, string> = {
  google_ads: 'var(--m-google)',
  yahoo_search: 'var(--m-yahoo)',
  yahoo_display: 'var(--m-yahoo)',
  meta: 'var(--m-meta)',
  line_ads: 'var(--m-line)',
  tiktok: 'var(--m-tiktok)',
  x_ads: 'var(--m-x)',
  microsoft_ads: 'var(--m-ms)',
  amazon_ads: 'var(--m-amazon)',
};

export const PLATFORM_SHORT_LABEL: Record<Platform, string> = {
  google_ads: 'Google',
  yahoo_search: 'Y!検索',
  yahoo_display: 'Y!DSP',
  meta: 'Meta',
  line_ads: 'LINE',
  tiktok: 'TikTok',
  x_ads: 'X',
  microsoft_ads: 'Microsoft',
  amazon_ads: 'Amazon',
};

export const CONNECTION_STATUS_META: Record<ConnectionStatus, { label: string; colorVar: string }> = {
  connected: { label: '接続中', colorVar: 'var(--good)' },
  needs_reauth: { label: '要再認証', colorVar: 'var(--warn)' },
  error: { label: 'エラー', colorVar: 'var(--bad)' },
  not_connected: { label: '未接続', colorVar: 'var(--muted)' },
};

export const AUDIT_CATEGORY_LABEL: Record<string, string> = {
  measurement: '計測',
  budget: '予算',
  structure: '構成',
  bidding: '入札',
  creative: 'クリエイティブ',
  other: 'その他',
};

export const CONFIDENCE_LABEL: Record<string, string> = {
  high: '確信度 高',
  mid: '確信度 中',
  low: '確信度 低',
};

export const REPORT_SECTION_LABEL: Record<string, string> = {
  result: '結果',
  cause: '要因',
  action: '次のアクション',
};

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  operator: 'オペレーター',
  viewer: '閲覧のみ',
};

export const USAGE_FEATURE_LABEL: Record<string, string> = {
  audit: 'AI診断',
  report: 'レポート',
  copy: '広告文',
  format_detect: 'CSV判定',
};

export const INDUSTRY_LABEL: Record<string, string> = {
  ec: 'EC・通販',
  beauty: '美容・サロン',
  saas: 'SaaS・IT',
  finance: '金融',
  hr: '人材',
  other: 'その他',
};
