import { twoProportionPValue } from './benchmarks';

/**
 * 増分効果テスト (インクリメンタリティ / ホールドアウト) (F-42)。
 * 広告を見せない対照群(control)と露出群(exposed)のCVRを比べ、広告が「本当に生んだ」
 * 増分CV・増分CPA・リフトを算出する。有意差は two-proportion z 検定で判定。
 */

export type LiftMethod = 'geo' | 'audience' | 'holdback';
export type LiftStatus = 'planning' | 'running' | 'done';

export const LIFT_METHOD_LABEL: Record<LiftMethod, string> = {
  geo: '地域分割 (Geo)',
  audience: 'オーディエンス分割',
  holdback: '配信ホールドバック',
};

export interface LiftTestDto {
  id: string;
  clientId: string | null;
  name: string;
  method: LiftMethod;
  holdoutPct: number;
  startDate: string | null;
  endDate: string | null;
  status: LiftStatus;
  exposedAudience: number | null;
  exposedConversions: number | null;
  exposedCost: number | null;
  controlAudience: number | null;
  controlConversions: number | null;
  note: string;
  createdAt: string;
  /** 結果入力が揃っていれば算出した増分効果 */
  result: LiftResult | null;
}

export interface CreateLiftTestInput {
  name: string;
  method?: LiftMethod;
  holdoutPct?: number;
  clientId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateLiftTestInput {
  name?: string;
  status?: LiftStatus;
  startDate?: string | null;
  endDate?: string | null;
  exposedAudience?: number | null;
  exposedConversions?: number | null;
  exposedCost?: number | null;
  controlAudience?: number | null;
  controlConversions?: number | null;
  note?: string;
}

export interface LiftResultInput {
  exposedAudience: number; // 露出群の規模 (人 or インプレッション)
  exposedConversions: number;
  exposedCost: number; // 露出群にかけた広告費
  controlAudience: number; // 対照群の規模
  controlConversions: number;
}

export interface LiftResult {
  exposedCvr: number; // %
  controlCvr: number; // %
  /** 増分CV = (露出CVR - 対照CVR) × 露出規模 */
  incrementalConversions: number;
  /** 増分CPA = 広告費 / 増分CV */
  incrementalCpa: number | null;
  /** リフト率 = (露出CVR - 対照CVR) / 対照CVR × 100 */
  liftPct: number | null;
  pValue: number | null;
  significant: boolean; // p < 0.05
  /** 対照群CVRを「広告なしのベースライン」とした自然発生CV(露出群内) */
  baselineConversions: number;
  note: string;
}

export function computeLift(input: LiftResultInput): LiftResult {
  const ea = Math.max(0, input.exposedAudience);
  const ca = Math.max(0, input.controlAudience);
  const ec = Math.max(0, input.exposedConversions);
  const cc = Math.max(0, input.controlConversions);
  const exposedCvr = ea > 0 ? (ec / ea) * 100 : 0;
  const controlCvr = ca > 0 ? (cc / ca) * 100 : 0;
  const baselineConversions = (controlCvr / 100) * ea; // 露出群が広告なしでも起きたはずのCV
  const incrementalConversions = Math.max(0, ec - baselineConversions);
  const incrementalCpa = incrementalConversions > 0 ? Math.round(input.exposedCost / incrementalConversions) : null;
  const liftPct = controlCvr > 0 ? +(((exposedCvr - controlCvr) / controlCvr) * 100).toFixed(1) : null;
  const pValue = twoProportionPValue(cc, ca, ec, ea);
  const significant = pValue !== null && pValue < 0.05;

  const note = !ea || !ca
    ? '露出群・対照群の規模を入力すると増分効果を算出します。'
    : significant
      ? `広告による増分は統計的に有意です (p=${pValue?.toFixed(3)})。この増分CPAが本当の獲得効率です。`
      : `まだ有意差は出ていません (p=${pValue !== null ? pValue.toFixed(3) : '—'})。サンプルを増やすか期間を延ばしてください。`;

  return {
    exposedCvr: +exposedCvr.toFixed(3),
    controlCvr: +controlCvr.toFixed(3),
    incrementalConversions: +incrementalConversions.toFixed(1),
    incrementalCpa,
    liftPct,
    pValue: pValue !== null ? +pValue.toFixed(4) : null,
    significant,
    baselineConversions: +baselineConversions.toFixed(1),
    note,
  };
}
