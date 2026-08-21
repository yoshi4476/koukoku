import type { KeywordAction } from '@adgrid/shared';

/**
 * キーワード最適化の判定ロジック (純関数)。DB非依存でテスト可能。
 * KeywordsService から利用する。
 */

/** 0-100 の総合効率スコア。CVR/CPA/ROAS/CTR を業種相場で正規化して加重平均 */
export function efficiencyScore(a: {
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  bm: { ctr: number; cvr: number; cpa: number };
}): number {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const cvrScore = a.cvr == null ? 0 : clamp01(a.cvr / (a.bm.cvr * 2));
  const ctrScore = a.ctr == null ? 0 : clamp01(a.ctr / (a.bm.ctr * 2));
  const cpaScore = a.cpa == null ? 0 : clamp01(a.bm.cpa / a.cpa / 2); // 低いほど良い
  const roasScore = a.roas == null ? 0 : clamp01(a.roas / 300); // 300%で満点
  const score = cvrScore * 0.3 + cpaScore * 0.3 + roasScore * 0.25 + ctrScore * 0.15;
  return Math.round(score * 100);
}

export interface KeywordRecommendation {
  action: KeywordAction;
  bidChangePct: number;
  reason: string;
  expectedImpact: string;
}

/** 増額/維持/減額/停止 と増減率・理由・期待効果を決める */
export function recommendKeyword(a: {
  clicks: number;
  cost: number;
  conversions: number;
  cpa: number | null;
  roas: number | null;
  efficiency: number;
  bm: { cpa: number };
}): KeywordRecommendation {
  const { clicks, cost, conversions, cpa, roas, efficiency, bm } = a;

  // CV=0 の扱い: 費用と学習量で停止/減額/様子見を分ける
  if (conversions === 0) {
    if (cost >= 5000 && clicks >= 30) {
      return {
        action: 'pause',
        bidChangePct: -100,
        reason: `${clicks}クリック・${Math.round(cost).toLocaleString()}円かけてCV0件。獲得の見込みが薄いキーワードです`,
        expectedImpact: `停止で月 約${Math.round((cost / 28) * 30).toLocaleString()}円を他へ再配分できます`,
      };
    }
    if (cost >= 2000 && clicks >= 15) {
      return {
        action: 'decrease',
        bidChangePct: -40,
        reason: `CV0件ですが学習量が少なめ。入札を下げて損失を抑えつつ様子を見ます`,
        expectedImpact: `無駄消化を約40%圧縮 (月 約${Math.round(((cost * 0.4) / 28) * 30).toLocaleString()}円)`,
      };
    }
    return {
      action: 'keep',
      bidChangePct: 0,
      reason: `まだ${clicks}クリックで判断材料が不足。もう少しデータを貯めます`,
      expectedImpact: `維持して観察。30クリック到達で自動的に再評価されます`,
    };
  }

  // CVあり: 効率と対相場CPAで判定
  const cpaVsBm = cpa != null ? cpa / bm.cpa : 1;
  if (efficiency >= 62 && cpaVsBm <= 1.15) {
    const pct = efficiency >= 80 ? 40 : 25;
    const roasTxt = roas != null ? `ROAS ${roas}%` : `CPA ${cpa?.toLocaleString()}円`;
    return {
      action: 'increase',
      bidChangePct: pct,
      reason: `${roasTxt}で効率良好 (スコア${efficiency})。取りこぼしを減らすため増額の余地があります`,
      expectedImpact: `入札+${pct}%で表示機会を増やし、CVを月 約+${Math.max(1, Math.round(((conversions / 28) * 30 * pct) / 100 * 0.6))}件見込み`,
    };
  }
  if (efficiency <= 35 || cpaVsBm >= 1.8) {
    return {
      action: 'decrease',
      bidChangePct: -35,
      reason: `CPA ${cpa?.toLocaleString()}円が相場(${bm.cpa.toLocaleString()}円)を大きく超過。採算が合っていません`,
      expectedImpact: `入札-35%でCPAを相場水準へ近づけ、赤字消化を圧縮します`,
    };
  }
  return {
    action: 'keep',
    bidChangePct: 0,
    reason: `効率は標準的 (スコア${efficiency})。大きな増減より現状維持が無難です`,
    expectedImpact: `維持。クリエイティブ改善やマッチタイプ調整の余地を検討`,
  };
}
