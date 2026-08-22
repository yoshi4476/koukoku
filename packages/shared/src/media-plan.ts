/**
 * 打ち出し方の自動提案 (メディアプラン)。
 * 業種 × 目的 × 月予算から、最適な媒体構成・予算配分・目標CPA・訴求・
 * ターゲティング・想定CVを算出する純関数。業種相場(benchmarks)と
 * 業種プロファイル(industry)を土台にする。一気通貫の起点。
 */
import type { Platform } from './platforms';
import { PLATFORM_META } from './platforms';
import type { AppealAxis } from './ai';
import type { ProjectGoal } from './api';
import { benchmarkFor } from './benchmarks';
import { industryProfileFor } from './industry';

export interface MediaPlanItem {
  platform: Platform;
  label: string;
  sharePct: number;
  monthlyBudget: number;
  reason: string;
  /** この媒体で使う広告メニュー/フォーマット (媒体の特徴) */
  format: string;
  /** 業種×媒体の専用プレイブック (素人がそのまま実行できる手順) */
  playbook: string;
}

/** 媒体ごとの特徴 (推奨フォーマット・強み・クリエイティブの勘所) */
export const PLATFORM_PROFILE: Record<Platform, { format: string; strength: string; creativeTip: string }> = {
  google_ads: { format: '検索広告 + P-MAX', strength: '今すぐ客を獲得', creativeTip: '検索意図に一致した見出しと、離脱しないLPを用意' },
  yahoo_search: { format: '検索広告', strength: '年齢層高め・PC比率高め', creativeTip: '指名KWと一般KWを分け、丁寧で信頼感のある訴求' },
  yahoo_display: { format: 'ディスプレイ (YDA)', strength: '潜在層への認知・追いかけ', creativeTip: 'バナーは1メッセージに絞り、特典を大きく' },
  meta: { format: 'Advantage+ / リール・ストーリーズ', strength: '興味関心×ビジュアル訴求', creativeTip: '縦型動画＋体験談・UGC風。1本1メッセージ' },
  line_ads: { format: 'トークリスト・友だち追加', strength: '圧倒的な到達と幅広い層', creativeTip: 'クーポン・限定感で「友だち追加」まで誘導' },
  tiktok: { format: 'インフィード動画', strength: '若年層・拡散力', creativeTip: '冒頭2秒で掴む音あり縦型UGC。テロップ必須' },
  x_ads: { format: 'プロモ投稿', strength: '拡散・話題化・リアルタイム', creativeTip: '会話に自然に乗る投稿。硬い広告感は避ける' },
  microsoft_ads: { format: '検索広告 (Bing)', strength: 'PC・法人・高年収に強い', creativeTip: 'BtoB訴求。競合が少なく安価に獲得しやすい' },
  amazon_ads: { format: 'スポンサープロダクト', strength: '購入直前の指名買い', creativeTip: '商品名・レビュー・在庫・価格を整える' },
  smartnews_ads: { format: 'インフィード広告', strength: 'ニュース閲読層・幅広い年齢', creativeTip: '記事風で自然な見出し。押し売り感を避ける' },
  criteo: { format: 'ダイナミックリターゲティング', strength: 'カゴ落ち・離脱客の回収', creativeTip: '商品フィードの精度が命。閲覧商品を出し分け' },
  pinterest: { format: 'ピン (画像/動画)', strength: '保存・検討する女性層', creativeTip: '世界観のある縦型ビジュアルで「保存」を狙う' },
};

export interface MediaPlanTargeting {
  regions: string;
  ageRange: string;
  gender: 'all' | 'male' | 'female';
  devices: 'all' | 'mobile' | 'desktop';
}

export interface MediaPlanDto {
  industryLabel: string;
  goalLabel: string;
  monthlyBudget: number;
  targetCpa: number;
  /** 目標ROAS (%)。獲得系のみ、それ以外は null */
  targetRoas: number | null;
  expectedCv: number;
  appealAxes: AppealAxis[];
  targeting: MediaPlanTargeting;
  conversionPoint: string;
  bidStrategy: 'maximize_conversions' | 'target_cpa' | 'target_roas' | 'maximize_clicks' | 'manual';
  media: MediaPlanItem[];
  note: string;
}

type Archetype = 'ec_visual' | 'local_store' | 'btob_lead' | 'app_growth' | 'consideration';

const INDUSTRY_ARCHETYPE: Record<string, Archetype> = {
  ec: 'ec_visual',
  apparel: 'ec_visual',
  beauty: 'local_store',
  food: 'local_store',
  bridal: 'local_store',
  automotive: 'local_store',
  medical: 'local_store',
  saas: 'btob_lead',
  btob: 'btob_lead',
  finance: 'btob_lead',
  app: 'app_growth',
  realestate: 'consideration',
  education: 'consideration',
  travel: 'consideration',
  hr: 'consideration',
  other: 'consideration',
};

/** アーキタイプ別の基本メディア構成 (share は合計100) と選定理由 */
const ARCHETYPE_MIX: Record<Archetype, { platform: Platform; share: number; reason: string }[]> = {
  ec_visual: [
    { platform: 'meta', share: 35, reason: 'ビジュアル訴求と興味関心ターゲティングに強い' },
    { platform: 'google_ads', share: 30, reason: '購入意欲の高い検索・ショッピングを獲得' },
    { platform: 'line_ads', share: 15, reason: '日本最大級の到達で新規・再訪を補完' },
    { platform: 'criteo', share: 10, reason: 'カゴ落ち・離脱客をリターゲティングで回収' },
    { platform: 'yahoo_search', share: 10, reason: '検索の取りこぼしを補完' },
  ],
  local_store: [
    { platform: 'google_ads', share: 30, reason: '「近くの◯◯」など来店直結の検索を獲得' },
    { platform: 'line_ads', share: 30, reason: 'クーポン・再来店の相性が良い' },
    { platform: 'meta', share: 25, reason: '地域×興味でビジュアル訴求' },
    { platform: 'yahoo_display', share: 15, reason: '地域の潜在層に広く認知' },
  ],
  btob_lead: [
    { platform: 'google_ads', share: 40, reason: '課題顕在層の検索でリードを獲得' },
    { platform: 'yahoo_search', share: 20, reason: '検索の到達を補完 (法人PC比率)' },
    { platform: 'microsoft_ads', share: 20, reason: 'PC・法人・高年収に強く競合が少ない' },
    { platform: 'meta', share: 20, reason: '役職・業種ターゲティングで資料DLを獲得' },
  ],
  app_growth: [
    { platform: 'tiktok', share: 35, reason: '若年層・短尺動画でインストールを伸ばす' },
    { platform: 'meta', share: 30, reason: '精度の高い最適化配信でCPIを抑える' },
    { platform: 'x_ads', share: 20, reason: '拡散・話題化で認知を広げる' },
    { platform: 'google_ads', share: 15, reason: 'アプリキャンペーンで面を広く獲得' },
  ],
  consideration: [
    { platform: 'google_ads', share: 35, reason: '比較検討中の検索を獲得' },
    { platform: 'meta', share: 25, reason: '興味関心で見込み客に接触' },
    { platform: 'yahoo_search', share: 20, reason: '検索の到達を補完' },
    { platform: 'yahoo_display', share: 20, reason: '検討期間中の追いかけ (リタゲ)' },
  ],
};

const FEMALE_INDUSTRIES = new Set(['beauty', 'apparel', 'bridal']);

function targetingFor(industryCode: string, arch: Archetype): MediaPlanTargeting {
  const gender: MediaPlanTargeting['gender'] = FEMALE_INDUSTRIES.has(industryCode) ? 'female' : 'all';
  switch (arch) {
    case 'ec_visual':
      return { regions: '全国', ageRange: '25-49', gender, devices: 'mobile' };
    case 'local_store':
      return { regions: '店舗の商圏 (近隣エリア)', ageRange: '20-59', gender, devices: 'mobile' };
    case 'btob_lead':
      return { regions: '全国', ageRange: '指定なし', gender: 'all', devices: 'desktop' };
    case 'app_growth':
      return { regions: '全国', ageRange: '18-34', gender: 'all', devices: 'mobile' };
    case 'consideration':
    default:
      return { regions: '全国', ageRange: '25-54', gender, devices: 'all' };
  }
}

/** 目的に応じてSNS/ディスプレイ寄り・検索寄りへ配分を微調整 */
const DISPLAY_SNS: ReadonlySet<Platform> = new Set<Platform>(['meta', 'tiktok', 'x_ads', 'pinterest', 'yahoo_display', 'line_ads']);
const SEARCH: ReadonlySet<Platform> = new Set<Platform>(['google_ads', 'yahoo_search', 'microsoft_ads']);

const GOAL_LABEL: Record<ProjectGoal, string> = {
  conversion: '獲得 (CV)',
  awareness: '認知',
  traffic: '誘導',
  store: '来店・予約',
};

export function recommendMediaPlan(
  industryCode: string,
  goal: ProjectGoal,
  monthlyBudget: number,
): MediaPlanDto {
  const bm = benchmarkFor(industryCode);
  const profile = industryProfileFor(industryCode);
  const arch = INDUSTRY_ARCHETYPE[industryCode] ?? 'consideration';
  const base = ARCHETYPE_MIX[arch].map((m) => ({ ...m }));

  // 目的による配分の微調整 (±8ポイントを移動)
  const shift = (from: ReadonlySet<Platform>, to: ReadonlySet<Platform>, pts: number) => {
    const fromItems = base.filter((m) => from.has(m.platform));
    const toItems = base.filter((m) => to.has(m.platform));
    if (!fromItems.length || !toItems.length) return;
    const each = pts / toItems.length;
    const cut = pts / fromItems.length;
    fromItems.forEach((m) => (m.share = Math.max(5, m.share - cut)));
    toItems.forEach((m) => (m.share += each));
  };
  if (goal === 'awareness') shift(SEARCH, DISPLAY_SNS, 8);
  else if (goal === 'conversion') shift(DISPLAY_SNS, SEARCH, 6);
  else if (goal === 'store') {
    const line = base.find((m) => m.platform === 'line_ads');
    if (line) line.share += 6;
    const g = base.find((m) => m.platform === 'google_ads');
    if (g) g.share = Math.max(5, g.share - 6);
  }

  // 正規化して合計100に
  const total = base.reduce((s, m) => s + m.share, 0);
  const topAppeal = profile.appealAxes[0] ?? '便益';
  const media: MediaPlanItem[] = base.map((m) => {
    const sharePct = Math.round((m.share / total) * 100);
    const pp = PLATFORM_PROFILE[m.platform];
    // 業種×媒体の専用プレイブックを生成 (素人がそのまま実行できる粒度)
    const ngHint = profile.ngWords.length ? `${profile.label}のNG表現(${profile.ngWords.slice(0, 2).join('・')}等)は避ける。` : '';
    const playbook = `${pp.format}で配信。${profile.label}で効く「${topAppeal}」を軸に、${pp.creativeTip}。CVは「${profile.cvLabel}」で計測。${ngHint}`;
    return {
      platform: m.platform,
      label: PLATFORM_META[m.platform].label,
      sharePct,
      monthlyBudget: Math.round((monthlyBudget * sharePct) / 100),
      reason: m.reason,
      format: pp.format,
      playbook,
    };
  });

  const targetCpa = bm.cpa;
  const expectedCv = monthlyBudget > 0 && targetCpa > 0 ? Math.round(monthlyBudget / targetCpa) : 0;
  const targetRoas = goal === 'conversion' || goal === 'store' ? 400 : null;
  const bidStrategy =
    goal === 'awareness' ? 'maximize_clicks' : goal === 'conversion' ? 'target_cpa' : 'maximize_conversions';

  return {
    industryLabel: bm.label,
    goalLabel: GOAL_LABEL[goal],
    monthlyBudget,
    targetCpa,
    targetRoas,
    expectedCv,
    appealAxes: profile.appealAxes,
    targeting: targetingFor(industryCode, arch),
    conversionPoint: profile.cvLabel,
    bidStrategy,
    media,
    note: `${bm.label}・${GOAL_LABEL[goal]}の一般的な最適解です。${profile.tip}`,
  };
}
