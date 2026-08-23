/**
 * 成約(商談)パイプライン (F-47)。広告で獲得したCVを、商談→受注(成約)まで追跡し、
 * 成約率・受注額・粗利ROAS を可視化する。広告→CV→成約→粗利 を一気通貫にする。
 */

export type DealStage = 'lead' | 'negotiation' | 'won' | 'lost';

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  lead: '見込み',
  negotiation: '商談中',
  won: '受注（成約）',
  lost: '失注',
};

export const DEAL_STAGES: DealStage[] = ['lead', 'negotiation', 'won', 'lost'];

export interface DealDto {
  id: string;
  clientId: string;
  projectId: string | null;
  name: string;
  stage: DealStage;
  value: number; // 受注額(円)
  grossMarginPct: number; // 粗利率(%)
  source: string;
  note: string;
  createdAt: string;
  closedAt: string | null;
}

export interface CreateDealInput {
  clientId: string;
  name: string;
  projectId?: string | null;
  stage?: DealStage;
  value?: number;
  grossMarginPct?: number;
  source?: string;
  note?: string;
}

export interface UpdateDealInput {
  name?: string;
  stage?: DealStage;
  value?: number;
  grossMarginPct?: number;
  source?: string;
  note?: string;
}

export interface DealSummaryDto {
  total: number;
  byStage: Record<DealStage, { count: number; value: number }>;
  /** 成約率 = 受注 / (受注+失注) */
  winRate: number | null;
  wonCount: number;
  wonValue: number;
  avgWonValue: number | null;
  /** 受注の粗利合計 = Σ 受注額×粗利率 */
  grossProfit: number;
  /** 直近30日の広告費 */
  adCost: number;
  /** 粗利ROAS = 粗利 / 広告費 ×100 */
  grossRoas: number | null;
  /** 進行中(見込み+商談)の受注見込み額 */
  pipelineValue: number;
}

export function computeDealSummary(deals: DealDto[], adCost: number): DealSummaryDto {
  const byStage: DealSummaryDto['byStage'] = {
    lead: { count: 0, value: 0 },
    negotiation: { count: 0, value: 0 },
    won: { count: 0, value: 0 },
    lost: { count: 0, value: 0 },
  };
  let grossProfit = 0;
  for (const d of deals) {
    const b = byStage[d.stage];
    b.count += 1;
    b.value += d.value;
    if (d.stage === 'won') grossProfit += Math.round((d.value * d.grossMarginPct) / 100);
  }
  const decided = byStage.won.count + byStage.lost.count;
  const winRate = decided > 0 ? +((byStage.won.count / decided) * 100).toFixed(1) : null;
  const avgWonValue = byStage.won.count > 0 ? Math.round(byStage.won.value / byStage.won.count) : null;
  const grossRoas = adCost > 0 ? Math.round((grossProfit / adCost) * 100) : null;
  return {
    total: deals.length,
    byStage,
    winRate,
    wonCount: byStage.won.count,
    wonValue: byStage.won.value,
    avgWonValue,
    grossProfit,
    adCost: Math.round(adCost),
    grossRoas,
    pipelineValue: byStage.lead.value + byStage.negotiation.value,
  };
}
