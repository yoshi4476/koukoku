import { benchmarkFor } from './benchmarks';

/**
 * KPIツリー / 逆算プランナー (F-37)。
 * 目標CV から、業種相場(CTR/CVR/CPA)を使って必要な予算・IMP・クリック・CTR・CVR を逆算する。
 * ユーザーが自社の実績(CTR/CVR/CPA)や客単価を入れれば、それを優先して精緻化する。
 */

export interface KpiTreeInput {
  industryCode: string;
  /** 目標CV数 (件/月) */
  targetCv: number;
  /** 目標CPA (円)。未指定なら業種相場 */
  targetCpa?: number | null;
  /** 想定CTR (%)。未指定なら業種相場 */
  ctr?: number | null;
  /** 想定CVR (%)。未指定なら業種相場 */
  cvr?: number | null;
  /** 客単価 (円)。指定すると売上・ROASも算出 */
  avgOrderValue?: number | null;
}

export interface KpiTree {
  cv: number;
  cpa: number;
  clicks: number;
  impressions: number;
  ctr: number; // %
  cvr: number; // %
  cpc: number; // 円
  cpm: number; // 円 (1000IMPあたり)
  monthlyBudget: number; // 円
  dailyBudget: number; // 円
  revenue: number | null; // 円/月
  roas: number | null; // %
  /** 使った前提と出所 */
  assumptions: { ctr: number; cvr: number; cpa: number; source: 'benchmark' | 'mixed' | 'custom' };
}

export function buildKpiTree(input: KpiTreeInput): KpiTree {
  const bm = benchmarkFor(input.industryCode);
  const cv = Math.max(0, input.targetCv || 0);
  const ctr = input.ctr && input.ctr > 0 ? input.ctr : bm.ctr;
  const cvr = input.cvr && input.cvr > 0 ? input.cvr : bm.cvr;
  const cpa = input.targetCpa && input.targetCpa > 0 ? input.targetCpa : bm.cpa;

  const clicks = cvr > 0 ? cv / (cvr / 100) : 0;
  const impressions = ctr > 0 ? clicks / (ctr / 100) : 0;
  const monthlyBudget = Math.round(cv * cpa);
  const cpc = clicks > 0 ? monthlyBudget / clicks : 0;
  const cpm = impressions > 0 ? (monthlyBudget / impressions) * 1000 : 0;
  const revenue = input.avgOrderValue && input.avgOrderValue > 0 ? Math.round(cv * input.avgOrderValue) : null;
  const roas = revenue && monthlyBudget > 0 ? Math.round((revenue / monthlyBudget) * 100) : null;

  const custom = [input.ctr, input.cvr, input.targetCpa].filter((v) => v && v > 0).length;
  const source: KpiTree['assumptions']['source'] = custom === 0 ? 'benchmark' : custom >= 3 ? 'custom' : 'mixed';

  return {
    cv,
    cpa,
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    ctr: +ctr.toFixed(2),
    cvr: +cvr.toFixed(2),
    cpc: Math.round(cpc),
    cpm: Math.round(cpm),
    monthlyBudget,
    dailyBudget: Math.round(monthlyBudget / 30.4), // 入稿シート(30.4)と揃える
    revenue,
    roas,
    assumptions: { ctr: +ctr.toFixed(2), cvr: +cvr.toFixed(2), cpa, source },
  };
}
