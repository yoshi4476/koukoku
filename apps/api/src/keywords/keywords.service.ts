import { Injectable } from '@nestjs/common';
import { benchmarkFor } from '@adgrid/shared';
import type {
  KeywordAction,
  KeywordOptimizeDto,
  KeywordRankItemDto,
  KeywordRowDto,
  Platform,
} from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';

type KwRow = {
  id: string;
  keyword: string;
  matchType: string;
  platform: string;
  clientId: string;
  adAccountId: string;
  currentBid: unknown;
  qualityScore: number | null;
  impressions: bigint;
  clicks: bigint;
  cost: unknown;
  conversions: unknown;
  conversionValue: unknown;
  windowDays: number;
  client: { name: string; industryCode: string };
  adAccount: { name: string };
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));

@Injectable()
export class KeywordsService {
  constructor(private readonly prisma: PrismaService) {}

  async optimize(
    tenantId: string,
    opts: { clientId?: string; query?: string } = {},
  ): Promise<KeywordOptimizeDto> {
    const rowsRaw = await this.prisma.withTenant(tenantId, (tx) =>
      tx.keywordStat.findMany({
        where: opts.clientId ? { clientId: opts.clientId } : undefined,
        include: { client: { select: { name: true, industryCode: true } }, adAccount: { select: { name: true } } },
      }),
    );
    const rows = (rowsRaw as unknown as KwRow[]).map((r) => this.enrich(r));

    // 効率スコア降順で安定した並びにする
    rows.sort((a, b) => b.efficiency - a.efficiency);

    const windowDays = (rowsRaw[0] as KwRow | undefined)?.windowDays ?? 28;
    const industryLabel = opts.clientId
      ? benchmarkFor((rowsRaw[0] as KwRow | undefined)?.client.industryCode ?? 'other').label
      : '全業種ミックス';

    const topCtr = this.rankTopCtr(rows);
    const topRoi = this.rankTopRoi(rows);
    const bestBalance = this.rankBestBalance(rows);
    const summary = this.buildSummary(rows, windowDays);

    // 「キーワードを入れるだけ」— query は行の絞り込みのみ (相場・ランキングは全体基準を維持)
    const q = (opts.query ?? '').trim().toLowerCase();
    const shownRows = q ? rows.filter((r) => r.keyword.toLowerCase().includes(q)) : rows;

    return {
      totalKeywords: rows.length,
      windowDays,
      industryLabel,
      topCtr,
      bestBalance,
      topRoi,
      summary,
      rows: shownRows,
    };
  }

  /** 生の実績から指標・推奨・理由を算出する。業種相場を基準に正規化 (業種モード) */
  private enrich(r: KwRow): KeywordRowDto {
    const impressions = Number(r.impressions);
    const clicks = Number(r.clicks);
    const cost = num(r.cost);
    const conversions = num(r.conversions);
    const conversionValue = num(r.conversionValue);
    const bm = benchmarkFor(r.client.industryCode);

    const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null;
    const cpc = clicks > 0 ? Math.round(cost / clicks) : null;
    const cpa = conversions > 0 ? Math.round(cost / conversions) : null;
    const cvr = clicks > 0 ? +((conversions / clicks) * 100).toFixed(2) : null;
    const roas = cost > 0 ? +((conversionValue / cost) * 100).toFixed(0) : null;
    const roi = conversionValue > 0 && cost > 0 ? +(((conversionValue - cost) / cost) * 100).toFixed(0) : null;

    const efficiency = this.efficiencyScore({ ctr, cvr, cpa, roas, bm });
    const rec = this.recommend({ clicks, cost, conversions, cpa, roas, efficiency, bm });
    const currentBid = r.currentBid == null ? null : num(r.currentBid);
    const recommendedBid =
      currentBid != null && rec.action !== 'pause'
        ? Math.max(1, Math.round(currentBid * (1 + rec.bidChangePct / 100)))
        : rec.action === 'pause'
          ? 0
          : null;

    return {
      id: r.id,
      keyword: r.keyword,
      matchType: (r.matchType as KeywordRowDto['matchType']) ?? 'phrase',
      platform: r.platform as Platform,
      clientId: r.clientId,
      clientName: r.client.name,
      adAccountId: r.adAccountId,
      accountName: r.adAccount.name,
      impressions,
      clicks,
      cost: Math.round(cost),
      conversions: +conversions.toFixed(1),
      conversionValue: Math.round(conversionValue),
      currentBid,
      qualityScore: r.qualityScore,
      ctr,
      cpc,
      cpa,
      cvr,
      roas,
      roi,
      efficiency,
      action: rec.action,
      recommendedBid,
      bidChangePct: rec.bidChangePct,
      reason: rec.reason,
      expectedImpact: rec.expectedImpact,
    };
  }

  /** 0-100 の総合効率スコア。CVR/CPA/ROAS/CTR を業種相場で正規化して加重平均 */
  private efficiencyScore(a: {
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

  /** 増額/維持/減額/停止 と増減率・理由・期待効果を決める */
  private recommend(a: {
    clicks: number;
    cost: number;
    conversions: number;
    cpa: number | null;
    roas: number | null;
    efficiency: number;
    bm: { cpa: number };
  }): { action: KeywordAction; bidChangePct: number; reason: string; expectedImpact: string } {
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

  private toRank(r: KeywordRowDto, metricLabel: string, metricValue: number, note: string): KeywordRankItemDto {
    return { keyword: r.keyword, clientName: r.clientName, platform: r.platform, metricLabel, metricValue, note };
  }

  /** 最もクリック率が高い (表示機会が一定以上あるもの) */
  private rankTopCtr(rows: KeywordRowDto[]): KeywordRankItemDto[] {
    return rows
      .filter((r) => r.impressions >= 200 && r.ctr != null)
      .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0))
      .slice(0, 5)
      .map((r) => this.toRank(r, 'CTR', r.ctr ?? 0, `${r.impressions.toLocaleString()}表示 / ${r.clicks}クリック`));
  }

  /** ROIが高い (CV実績が一定以上あるもの) */
  private rankTopRoi(rows: KeywordRowDto[]): KeywordRankItemDto[] {
    return rows
      .filter((r) => r.conversions >= 3 && r.roi != null)
      .sort((a, b) => (b.roi ?? -1e9) - (a.roi ?? -1e9))
      .slice(0, 5)
      .map((r) => this.toRank(r, 'ROI', r.roi ?? 0, `CV ${r.conversions}件 / ROAS ${r.roas ?? 0}%`));
  }

  /** 金額感のバランスが取れている (効率スコアが高く、CVも出ている) */
  private rankBestBalance(rows: KeywordRowDto[]): KeywordRankItemDto[] {
    return rows
      .filter((r) => r.conversions >= 3 && r.efficiency >= 45)
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5)
      .map((r) =>
        this.toRank(
          r,
          '効率スコア',
          r.efficiency,
          `CPA ${r.cpa?.toLocaleString() ?? '-'}円 / CTR ${r.ctr ?? 0}% / ROAS ${r.roas ?? 0}%`,
        ),
      );
  }

  private buildSummary(rows: KeywordRowDto[], windowDays: number): KeywordOptimizeDto['summary'] {
    const toMonthly = (v: number) => (v / windowDays) * 30;
    let increaseCount = 0;
    let decreaseCount = 0;
    let pauseCount = 0;
    let reclaimableBudget = 0;
    let projectedCvGain = 0;

    for (const r of rows) {
      if (r.action === 'increase') {
        increaseCount++;
        projectedCvGain += (toMonthly(r.conversions) * r.bidChangePct) / 100 * 0.6;
      } else if (r.action === 'decrease') {
        decreaseCount++;
        reclaimableBudget += toMonthly(r.cost) * (Math.abs(r.bidChangePct) / 100);
      } else if (r.action === 'pause') {
        pauseCount++;
        reclaimableBudget += toMonthly(r.cost);
      }
    }

    return {
      increaseCount,
      decreaseCount,
      pauseCount,
      reclaimableBudget: Math.round(reclaimableBudget),
      projectedCvGain: +projectedCvGain.toFixed(1),
    };
  }
}
