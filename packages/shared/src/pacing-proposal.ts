/**
 * ペーシング→予算提案の自動生成 (F-51 自動反映ループの締め)。
 * 予算ペーシングの逸脱を、承認キューに載る adjust_budget 提案(の下書き)に変換する純関数。
 * 実行は必ず人手承認を挟む(=ループの安全な締め)。ここでは「提案すべきか/新月予算はいくらか」だけを決める。
 */
import type { PacingDto } from './api';

/** 着地見込みが月予算の ±この%を超えたら提案対象 */
export const PACING_DEVIATION_THRESHOLD = 15;

export interface PacingProposalDraft {
  adAccountId: string;
  accountName: string;
  newMonthlyBudget: number;
  direction: 'increase' | 'decrease';
  title: string;
  evidence: string;
  risk: string;
  confidence: 'high' | 'mid' | 'low';
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * ペーシング1件から予算提案の下書きを作る。対象外なら null。
 * 方針: 月予算を実効ペース(着地見込み)に right-size する。1000円単位に丸める。
 */
export function buildPacingProposal(p: PacingDto): PacingProposalDraft | null {
  if (p.monthToDateCost <= 0 || p.monthlyBudget <= 0) return null;
  const deviation = p.projectedPct - 100;
  if (Math.abs(deviation) < PACING_DEVIATION_THRESHOLD) return null;

  const newMonthlyBudget = Math.max(1000, Math.round(p.projectedMonthEnd / 1000) * 1000);
  if (newMonthlyBudget === p.monthlyBudget) return null;

  const direction: PacingProposalDraft['direction'] = newMonthlyBudget > p.monthlyBudget ? 'increase' : 'decrease';
  const confidence: PacingProposalDraft['confidence'] = Math.abs(deviation) >= 30 ? 'high' : 'mid';

  const title =
    p.status === 'over'
      ? `予算超過ペース: 着地見込み ${p.projectedPct}% (${p.accountName})`
      : `予算消化不足: 着地見込み ${p.projectedPct}% (${p.accountName})`;

  const evidence =
    `現在の消化ペース(日平均${yen(p.currentDailyAvg)})だと月末着地は${yen(p.projectedMonthEnd)}` +
    `＝月予算${yen(p.monthlyBudget)}の${p.projectedPct}%の見込みです。` +
    `月予算を実効ペースに合わせて${yen(newMonthlyBudget)}へ${direction === 'increase' ? '増額' : '減額'}する提案です。` +
    `据え置く場合は日予算を${yen(p.recommendedDailyBudget)}に${p.status === 'over' ? '抑える' : '引き上げる'}ことで予算内に着地します。`;

  const risk =
    direction === 'increase'
      ? '増額は消化増につながります。獲得効率(CPA/ROAS)が目標内であることを確認してください。'
      : '減額は配信機会の減少につながります。好調な配信を絞りすぎないか確認してください。';

  return { adAccountId: p.adAccountId, accountName: p.accountName, newMonthlyBudget, direction, title, evidence, risk, confidence };
}

/** ペーシング一覧から提案候補をまとめて作る (逸脱の大きい順) */
export function buildPacingProposals(list: PacingDto[]): PacingProposalDraft[] {
  return list
    .map(buildPacingProposal)
    .filter((d): d is PacingProposalDraft => d !== null);
}

/** ペーシング自動提案スイープの結果 */
export interface PacingSweepItem {
  adAccountId: string;
  accountName: string;
  title: string;
  newMonthlyBudget: number;
  direction: 'increase' | 'decrease';
  created: boolean; // false = 既に保留中の提案があり重複回避でスキップ
}

export interface PacingSweepDto {
  scanned: number; // 予算逸脱で提案候補になった件数
  created: number; // 新規に承認キューへ載せた件数
  skipped: number; // 重複でスキップした件数
  items: PacingSweepItem[];
}
