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
  beauty: { code: 'beauty', label: '美容・サロン', ctr: 1.0, cvr: 1.5, cpa: 6000 },
  saas: { code: 'saas', label: 'SaaS・IT', ctr: 1.5, cvr: 1.0, cpa: 15000 },
  finance: { code: 'finance', label: '金融・保険', ctr: 0.8, cvr: 0.8, cpa: 20000 },
  hr: { code: 'hr', label: '人材・採用', ctr: 1.0, cvr: 1.2, cpa: 10000 },
  realestate: { code: 'realestate', label: '不動産', ctr: 0.9, cvr: 0.6, cpa: 25000 },
  education: { code: 'education', label: '教育・スクール', ctr: 1.1, cvr: 1.3, cpa: 8000 },
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
