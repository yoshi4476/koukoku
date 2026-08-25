/**
 * 検索キーワードの自動設計 (F-57)。
 * 「今すぐ客」から順に取り、無駄クリックを生む語は除外キーワードに落とす。
 * 広告効率(CPA)はキーワード選定で大きく決まるため、意図の強さで層別する。
 */

/** 検索意図の層。上ほど成約に近く、CPAが低い */
export type IntentTier = 'now' | 'compare' | 'explore';

export const INTENT_LABEL: Record<IntentTier, string> = {
  now: '今すぐ客（依頼・申込意図）',
  compare: '比較検討客（料金・比較・おすすめ）',
  explore: '情報収集客（方法・とは）',
};

export interface PlannedKeyword {
  text: string;
  tier: IntentTier;
  /** なぜこの語を入れるか (画面表示用) */
  reason: string;
}

export interface KeywordPlanDto {
  keywords: PlannedKeyword[];
  /** 無駄クリックを生む語。除外キーワードとして登録する */
  negatives: string[];
  note: string;
  mocked: boolean;
}

/** 意図を強める語尾。上から順に成約に近い */
const NOW_SUFFIX = ['代行', '依頼', '相談', '申込', '見積もり', '予約'];
const COMPARE_SUFFIX = ['料金', '費用', '比較', 'おすすめ', '評判', '実績'];
const EXPLORE_SUFFIX = ['とは', 'やり方', '方法'];

/**
 * ほぼ確実に成果につながらない検索。除外しないと予算を溶かす。
 * 「無料/自分で」= 発注意思なし、「求人/転職」= 求職者、「事例/とは」= 情報収集のみ。
 */
const BASE_NEGATIVES = [
  '無料', '自分で', 'やり方', '独学', '練習',
  '求人', 'バイト', '転職', '採用', '年収', '正社員',
  '意味', 'とは', 'wiki', 'とは何',
  '苦情', 'クレーム', '炎上', '訴訟', '詐欺',
  '中古', '無料ツール', 'フリーソフト', 'テンプレート 無料',
];

/** 業種ごとに追加で外すべき語 (発注意思が無い検索) */
const INDUSTRY_NEGATIVES: Record<string, string[]> = {
  saas: ['オープンソース', '無料プラン', '代替', 'クラック'],
  ec: ['メルカリ', '中古', '転売', '返品方法'],
  beauty: ['セルフ', '市販', '100均', '自宅で'],
  hr: ['履歴書 書き方', '面接 対策', '退職'],
  realestate: ['diy', '自分で 内装'],
  medical: ['市販薬', '自然治癒', '民間療法'],
  education: ['独学', '無料動画', 'pdf'],
  legal: ['自分で 手続き', '書式 無料'],
};

function clean(s: string): string {
  return s.replace(/[\s　]+/g, ' ').trim();
}

/** 文章から名詞らしい短語を拾う (決定的・辞書なし) */
function coreTerms(text: string, max: number): string[] {
  if (!text) return [];
  const parts = text
    .split(/[、。,.\n・／/（）()「」【】]/)
    .map(clean)
    .filter((p) => p.length >= 2 && p.length <= 14)
    // 説明的すぎる句を落とす
    .filter((p) => !/[はがをにでともへや]$/.test(p))
    .filter((p) => !/(します|ます|です|できる|ください)/.test(p));
  return [...new Set(parts)].slice(0, max);
}

export interface KeywordPlanInput {
  industryLabel: string;
  industryCode: string;
  /** 商材・サービス名 (brief.product) */
  product: string;
  /** 事業内容 (brief.business) */
  business: string;
  /** 強み (brief.usp) */
  usp: string;
  /** 提供エリア (brief.area / settings.regions) */
  area: string;
}

/**
 * ヒアリングと業種から決定的にキーワード案を作る (LLM未接続時のフォールバック兼ベース)。
 * 地域指定がある場合は地域名を掛け合わせる (ローカル商材はCPAが大きく下がる)。
 */
export function buildKeywordPlan(input: KeywordPlanInput): KeywordPlanDto {
  const seeds = [
    ...coreTerms(input.product, 4),
    ...coreTerms(input.business, 2),
    input.industryLabel,
  ]
    .map(clean)
    .filter(Boolean);
  const uniqueSeeds = [...new Set(seeds)].slice(0, 5);

  const areas = coreTerms(input.area, 3).filter((a) => !/全国|オンライン|日本/.test(a));

  const keywords: PlannedKeyword[] = [];
  const push = (text: string, tier: IntentTier, reason: string) => {
    const t = clean(text);
    if (!t || t.length > 30) return;
    if (keywords.some((k) => k.text === t)) return;
    keywords.push({ text: t, tier, reason });
  };

  for (const seed of uniqueSeeds) {
    // 今すぐ客: 「◯◯ 代行」「◯◯ 依頼」＋地域掛け合わせ
    for (const suf of NOW_SUFFIX.slice(0, 4)) push(`${seed} ${suf}`, 'now', '発注意図が明確で成約に最も近い');
    for (const a of areas) {
      push(`${seed} ${a}`, 'now', '地域指定は競合が少なくCPAが下がりやすい');
      push(`${a} ${seed} 代行`, 'now', '地域×発注意図でもっとも効率が良い組み合わせ');
    }
    // 比較検討客
    for (const suf of COMPARE_SUFFIX.slice(0, 4)) push(`${seed} ${suf}`, 'compare', '検討中で、条件が合えば問い合わせる層');
  }
  // 情報収集は原則入れない (CPAが悪化するため)。予算に余裕がある場合のみ
  for (const seed of uniqueSeeds.slice(0, 1)) {
    for (const suf of EXPLORE_SUFFIX.slice(0, 1)) push(`${seed} ${suf}`, 'explore', '認知拡大用。CPAは悪化しやすいので予算に余裕がある場合のみ');
  }

  const negatives = [...new Set([...BASE_NEGATIVES, ...(INDUSTRY_NEGATIVES[input.industryCode] ?? [])])];

  return {
    keywords: keywords.slice(0, 60),
    negatives,
    note: areas.length > 0
      ? `${areas.join('・')}との掛け合わせを優先しています。地域名を含む検索は競合が少なく、同じ予算でも成約が取りやすくなります。`
      : '発注意図の強い語から順に並べています。情報収集の語は原則除外し、無駄クリックを抑えます。',
    mocked: true,
  };
}

/** 入稿に使う語だけを取り出す (情報収集層は既定で除外) */
export function launchableKeywords(plan: KeywordPlanDto, includeExplore = false): string[] {
  return plan.keywords
    .filter((k) => includeExplore || k.tier !== 'explore')
    .map((k) => k.text);
}
