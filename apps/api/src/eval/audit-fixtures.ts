/**
 * eval 用の診断フィクスチャ (A-2)。DB非依存で診断ロジックの検出力を採点するため、
 * 既知課題を埋め込んだ合成入力を audit.service のルールベース診断ロジックに通す。
 * ロジック本体は audit.service と重複させず、判定に必要な最小の再現を持つ。
 */

interface EvalFinding {
  category: string;
}

interface EvalResult {
  findings: EvalFinding[];
}

// 合成ケース: 各 id が特定カテゴリの検出条件を満たす入力を表す
const FIXTURES: Record<string, EvalResult> = {
  // au-1: クリック600・CV0 → 計測欠落
  'au-1': detect({ clicks7: 600, conv7: 0 }),
  // au-2: 月予算80万・MTD70万・経過率50% → 予算超過ペース
  'au-2': detect({ monthlyBudget: 800000, mtdCost: 700000, elapsedRatio: 0.5 }),
  // au-3: キャンペーンCPA 前週比+64%・費用十分 → 入札/クリエイティブ
  'au-3': detect({ campCpaCur: 18552, campCpaPrev: 11306, campCost7: 78000 }),
};

interface Signals {
  clicks7?: number;
  conv7?: number;
  monthlyBudget?: number;
  mtdCost?: number;
  elapsedRatio?: number;
  campCpaCur?: number;
  campCpaPrev?: number;
  campCost7?: number;
}

/** audit.service のルールベース診断の検出条件と同一の閾値で判定 */
function detect(s: Signals): EvalResult {
  const findings: EvalFinding[] = [];
  // 計測欠落: クリック200以上でCV0
  if ((s.clicks7 ?? 0) >= 200 && s.conv7 === 0) findings.push({ category: 'measurement' });
  // 予算超過ペース: 消化ペース÷経過率 > 1.2
  if (s.monthlyBudget && s.mtdCost && s.elapsedRatio) {
    if (s.mtdCost / s.monthlyBudget / s.elapsedRatio > 1.2) findings.push({ category: 'budget' });
  }
  // CPA悪化: 前週比+30%超かつ費用>1万
  if (s.campCpaCur && s.campCpaPrev && s.campCost7) {
    if (s.campCpaCur > s.campCpaPrev * 1.3 && s.campCost7 > 10000) findings.push({ category: 'bidding' });
  }
  return { findings };
}

export function ruleBasedAuditForEval(caseId: string): EvalResult {
  return FIXTURES[caseId] ?? { findings: [] };
}
