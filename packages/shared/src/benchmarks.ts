/**
 * 業種別ベンチマーク (A-3)。
 * 注意: 初期値は一般的な相場感の暫定値。実データ蓄積後 (勝ちパターン資産集 B-1) に
 * 自社実績由来の値へ置き換える。対外利用時は出典明示・要一次確認。
 */
export interface IndustryBenchmark {
  code: string;
  label: string;
  ctr: number; // %
  cvr: number; // % (クリック→CV)
  cpa: number; // 円
}

export const INDUSTRY_BENCHMARKS: Record<string, IndustryBenchmark> = {
  ec: { code: 'ec', label: 'EC・物販', ctr: 1.2, cvr: 2.0, cpa: 4000 },
  apparel: { code: 'apparel', label: 'アパレル・ファッション', ctr: 1.4, cvr: 1.8, cpa: 3500 },
  beauty: { code: 'beauty', label: '美容・サロン', ctr: 1.0, cvr: 1.5, cpa: 6000 },
  food: { code: 'food', label: '飲食・グルメ', ctr: 1.3, cvr: 2.5, cpa: 3000 },
  saas: { code: 'saas', label: 'SaaS・IT', ctr: 1.5, cvr: 1.0, cpa: 15000 },
  app: { code: 'app', label: 'アプリ・ゲーム', ctr: 1.6, cvr: 3.0, cpa: 500 },
  btob: { code: 'btob', label: 'BtoB・製造/法人', ctr: 1.3, cvr: 0.9, cpa: 18000 },
  finance: { code: 'finance', label: '金融・保険', ctr: 0.8, cvr: 0.8, cpa: 20000 },
  hr: { code: 'hr', label: '人材・採用', ctr: 1.0, cvr: 1.2, cpa: 10000 },
  realestate: { code: 'realestate', label: '不動産', ctr: 0.9, cvr: 0.6, cpa: 25000 },
  bridal: { code: 'bridal', label: 'ブライダル', ctr: 1.0, cvr: 1.2, cpa: 15000 },
  automotive: { code: 'automotive', label: '自動車', ctr: 0.9, cvr: 1.0, cpa: 12000 },
  medical: { code: 'medical', label: '医療・クリニック', ctr: 1.0, cvr: 2.0, cpa: 8000 },
  travel: { code: 'travel', label: '旅行・観光', ctr: 1.1, cvr: 1.5, cpa: 5000 },
  education: { code: 'education', label: '教育・スクール', ctr: 1.1, cvr: 1.3, cpa: 8000 },
  clinic_beauty: { code: 'clinic_beauty', label: '美容クリニック・医療脱毛', ctr: 1.1, cvr: 2.2, cpa: 9000 },
  fitness: { code: 'fitness', label: 'フィットネス・ジム', ctr: 1.2, cvr: 2.0, cpa: 7000 },
  legal: { code: 'legal', label: '士業 (弁護士・税理士)', ctr: 1.0, cvr: 1.5, cpa: 12000 },
  repair: { code: 'repair', label: '整体・整骨院・鍼灸', ctr: 1.1, cvr: 2.3, cpa: 5000 },
  reform: { code: 'reform', label: 'リフォーム・工務店', ctr: 0.9, cvr: 1.0, cpa: 15000 },
  pet: { code: 'pet', label: 'ペット', ctr: 1.3, cvr: 1.8, cpa: 4000 },
  moving: { code: 'moving', label: '引越し・生活サービス', ctr: 1.0, cvr: 2.0, cpa: 6000 },
  funeral: { code: 'funeral', label: '冠婚葬祭・葬儀', ctr: 0.9, cvr: 2.5, cpa: 10000 },
  other: { code: 'other', label: 'その他', ctr: 1.0, cvr: 1.2, cpa: 8000 },
};

export function benchmarkFor(industryCode: string): IndustryBenchmark {
  return INDUSTRY_BENCHMARKS[industryCode] ?? INDUSTRY_BENCHMARKS.other;
}

/** CTR/CVRは高いほど良い、CPAは低いほど良い。相場±20%を平均帯とする */
export function verdictHigherBetter(value: number | null, benchmark: number): 'good' | 'avg' | 'poor' | 'na' {
  if (value === null) return 'na';
  if (value >= benchmark * 1.2) return 'good';
  if (value <= benchmark * 0.8) return 'poor';
  return 'avg';
}

export function verdictLowerBetter(value: number | null, benchmark: number): 'good' | 'avg' | 'poor' | 'na' {
  if (value === null) return 'na';
  if (value <= benchmark * 0.8) return 'good';
  if (value >= benchmark * 1.2) return 'poor';
  return 'avg';
}

/**
 * two-proportion z-test。2群の比率差が統計的に有意か判定する (A/Bテスト B-3)。
 * 標準正規分布の両側 p 値を返す。
 */
export function twoProportionPValue(
  convA: number,
  nA: number,
  convB: number,
  nB: number,
): number | null {
  if (nA <= 0 || nB <= 0) return null;
  const pA = convA / nA;
  const pB = convB / nB;
  const pPool = (convA + convB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return null;
  const z = (pB - pA) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** 標準正規分布の累積分布関数 (Abramowitz-Stegun 近似) */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - p;
}
