import type {
  Platform,
  ConnectionStatus,
  MemberRole,
  AlertMetric,
  KeywordAction,
  ProposalAction,
  ProposalStatus,
  KnowledgeObjective,
  CalibrationDto,
  ChangeLogDto,
  WidgetDimension,
  WidgetType,
} from '@adgrid/shared';
import { INDUSTRY_PROFILES } from '@adgrid/shared';

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
  smartnews_ads: 'var(--m-smartnews)',
  criteo: 'var(--m-criteo)',
  pinterest: 'var(--m-pinterest)',
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
  smartnews_ads: 'SmartNews',
  criteo: 'Criteo',
  pinterest: 'Pinterest',
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
  client: '提供先',
};

export const USAGE_FEATURE_LABEL: Record<string, string> = {
  audit: 'AI診断',
  report: 'レポート',
  copy: '広告文',
  creative: 'クリエイティブ生成',
  image: '画像生成 (Imagen)',
  format_detect: 'CSV判定',
};

export const ALERT_METRIC_META: Record<AlertMetric, { label: string; description: string; unit: string }> = {
  budget_pace: {
    label: '予算超過ペース',
    description: '月予算の消化ペースが経過率を上回ったら通知',
    unit: '%以上',
  },
  cpa_spike: {
    label: 'CPA急変',
    description: '直近7日CPAが前週比で悪化したら通知',
    unit: '%悪化',
  },
  cv_zero: {
    label: 'CV計測ゼロ',
    description: 'クリックがあるのにCVが0件 (計測欠落疑い)',
    unit: 'クリック以上',
  },
  spend_drop: {
    label: '消化急減',
    description: '昨日の消化が7日平均から急減 (配信停止疑い)',
    unit: '%減少',
  },
  benchmark_gap: {
    label: 'AI提案: 相場より低い',
    description: 'CVRが業種相場を大きく下回る (改善余地の提案)',
    unit: '%下回る',
  },
  roas_low: {
    label: 'AI提案: ROAS低下',
    description: 'ROASが低水準で赤字配信の疑い',
    unit: '%未満',
  },
  no_recent_audit: {
    label: '不備: 診断未実行',
    description: '配信中なのに一定期間AI診断していない',
    unit: '日以上',
  },
};

export const PROPOSAL_ACTION_LABEL: Record<ProposalAction, string> = {
  adjust_budget: '予算調整',
  adjust_bid: '入札調整',
  pause_campaign: '配信停止',
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: '承認待ち',
  approved: '承認済',
  rejected: '却下',
  executed: '実行済',
  failed: '失敗',
  rolled_back: 'ロールバック済',
};

/* 勝ちパターン資産集 (B-1) の目的ラベル */
export const KNOWLEDGE_OBJECTIVE_LABEL: Record<KnowledgeObjective, string> = {
  conversion: '獲得',
  awareness: '認知',
  traffic: '誘導',
};

/* 確信度較正 (A-4) の効果バッジ (cls は .pill バリアント) */
export const CALIBRATION_EFFECT_META: Record<CalibrationDto['effect'], { label: string; cls: string }> = {
  boost: { label: '確信度を強化', cls: 'up' },
  penalty: { label: '確信度を抑制', cls: 'down' },
  neutral: { label: '中立', cls: 'flat' },
  insufficient: { label: 'データ蓄積中', cls: 'flat' },
};

/* 変更履歴 (B-2) の実行主体バッジ (cls は .pill バリアント) */
export const CHANGELOG_ACTOR_META: Record<ChangeLogDto['actor'], { label: string; cls: string }> = {
  adgrid: { label: 'ADGRID', cls: 'ai' },
  media_console: { label: '媒体管理画面', cls: 'flat' },
  api: { label: 'API同期', cls: 'flat' },
};

/* カスタムダッシュボード (B-5) の集計軸・種別ラベル */
export const WIDGET_DIMENSION_LABEL: Record<WidgetDimension, string> = {
  none: '集計なし',
  platform: '媒体別',
  client: 'クライアント別',
  date: '日別',
};

export const WIDGET_TYPE_LABEL: Record<WidgetType, string> = {
  stat: '数値',
  bar: '横棒',
  line: '折れ線',
  table: '表',
};

/* キーワード最適化 (F-18) の推奨アクション。cls は .pill バリアント */
export const KEYWORD_ACTION_META: Record<
  KeywordAction,
  { label: string; cls: string; icon: string }
> = {
  increase: { label: '増額', cls: 'up', icon: '▲' },
  keep: { label: '維持', cls: 'flat', icon: '＝' },
  decrease: { label: '減額', cls: 'warn', icon: '▼' },
  pause: { label: '停止', cls: 'down', icon: '■' },
};

export const MATCH_TYPE_LABEL: Record<string, string> = {
  exact: '完全一致',
  phrase: 'フレーズ',
  broad: '部分一致',
};

/* 業種ラベルは共有の業種プロファイルから生成し、相場・診断・広告文・用語の
   最適化と選択肢を常に一致させる (ドリフト防止) */
export const INDUSTRY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(INDUSTRY_PROFILES).map(([code, p]) => [code, p.label]),
);
