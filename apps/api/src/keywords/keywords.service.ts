import { HttpStatus, Injectable } from '@nestjs/common';
import { benchmarkFor, industryProfileFor } from '@adgrid/shared';
import type {
  CreateProposalInput,
  KeywordAction,
  KeywordDiscoveryDto,
  KeywordKind,
  KeywordOptimizeDto,
  KeywordRankItemDto,
  KeywordRowDto,
  KeywordSuggestionDto,
  Platform,
  ProposalDto,
  VolumeBucket,
} from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import type { SessionInfoValue } from '../common/tenant';
import { ProposalsService } from '../proposals/proposals.service';
import { efficiencyScore, recommendKeyword } from './keyword-scoring';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
  ) {}

  /** キーワードの推奨(増額/減額/停止)を承認キューへ提案として起票する。
   *  「計測→AI提案→承認→適用」を一気通貫でつなぐ。keep は起票不可 */
  async propose(tenantId: string, user: SessionInfoValue, keywordId: string): Promise<ProposalDto> {
    const kwRaw = await this.prisma.withTenant(tenantId, (tx) =>
      tx.keywordStat.findUnique({
        where: { id: keywordId },
        include: { client: { select: { name: true, industryCode: true } }, adAccount: { select: { name: true } } },
      }),
    );
    if (!kwRaw) {
      throw new AppError(HttpStatus.NOT_FOUND, 'キーワードが見つかりません。', '一覧を再読み込みしてください。');
    }
    const r = this.enrich(kwRaw as unknown as KwRow);
    if (r.action === 'keep') {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'このキーワードは「維持」推奨のため提案は不要です。',
        '増額・減額・停止が推奨されているキーワードから申請してください。',
      );
    }

    const actionLabel = r.action === 'increase' ? '増額' : r.action === 'decrease' ? '減額' : '停止';
    const input: CreateProposalInput = {
      adAccountId: r.adAccountId,
      actionType: r.action === 'pause' ? 'pause_campaign' : 'adjust_bid',
      actionPayload:
        r.action === 'pause'
          ? { keyword: r.keyword, campaignId: r.keyword, matchType: r.matchType, currentBid: r.currentBid }
          : { keyword: r.keyword, campaignId: r.keyword, matchType: r.matchType, percent: r.bidChangePct, currentBid: r.currentBid, recommendedBid: r.recommendedBid },
      title: `キーワード${actionLabel}: ${r.keyword}`,
      evidence: r.reason,
      risk: r.expectedImpact,
      confidence: r.efficiency >= 70 || r.action === 'pause' ? 'high' : 'mid',
    };
    return this.proposals.create(tenantId, user, input);
  }

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

  /** キーワード発見・拡張 (F-20)。既存KWと業種から、獲得に効く新規KWを提案 */
  async discover(tenantId: string, clientId?: string): Promise<KeywordDiscoveryDto> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.keywordStat.findMany({
        where: clientId ? { clientId } : undefined,
        include: { client: { select: { industryCode: true } } },
      }),
    );
    const industryCode = clientId
      ? ((rows[0] as unknown as { client: { industryCode: string } } | undefined)?.client.industryCode ?? 'other')
      : 'other';
    const bm = benchmarkFor(industryCode);
    const profile = industryProfileFor(industryCode);

    // 既存の平均CPC (推定CPCの基準)。無ければ業種CPAから概算
    let totCost = 0;
    let totClicks = 0;
    const existing = new Set<string>();
    const stems: string[] = [];
    for (const r of rows as unknown as KwRow[]) {
      existing.add(r.keyword);
      totCost += Number(r.cost);
      totClicks += Number(r.clicks);
      // 指名・記号を除いた一般語を種にする
      const first = r.keyword.split(/\s+/)[0];
      if (first && first.length >= 2 && !stems.includes(first)) stems.push(first);
    }
    const avgCpc = totClicks > 0 ? Math.round(totCost / totClicks) : Math.max(50, Math.round(bm.cpa / 30));
    if (stems.length === 0) stems.push(profile.label.split(/[・(]/)[0]);

    const MODIFIERS: { suffix: string; kind: KeywordKind; volume: VolumeBucket; cpcFactor: number; priority: KeywordSuggestionDto['priority']; why: string }[] = [
      { suffix: '料金', kind: 'purchase', volume: 'mid', cpcFactor: 1.1, priority: 'high', why: '料金を調べる=比較検討中で獲得に近い' },
      { suffix: 'おすすめ', kind: 'purchase', volume: 'mid', cpcFactor: 1.0, priority: 'high', why: '選定中の顕在層。指名前の最後の一押し' },
      { suffix: '比較', kind: 'competitor', volume: 'mid', cpcFactor: 1.2, priority: 'mid', why: '比較検討層。競合と並べて強みを訴求' },
      { suffix: '口コミ', kind: 'longtail', volume: 'low', cpcFactor: 0.8, priority: 'high', why: 'ロングテールで安く獲得しやすい' },
      { suffix: '評判', kind: 'longtail', volume: 'low', cpcFactor: 0.8, priority: 'mid', why: '不安を解消したい層。実績・レビューで訴求' },
      { suffix: 'デメリット', kind: 'longtail', volume: 'low', cpcFactor: 0.7, priority: 'mid', why: '検討後半。正直な情報で信頼を得る' },
      { suffix: `${profile.cvLabel}`, kind: 'purchase', volume: 'low', cpcFactor: 1.3, priority: 'high', why: `「${profile.cvLabel}」意図で獲得に最も近い` },
    ];

    const suggestions: KeywordSuggestionDto[] = [];
    for (const stem of stems.slice(0, 4)) {
      for (const m of MODIFIERS) {
        const kw = `${stem} ${m.suffix}`;
        if (existing.has(kw) || suggestions.some((s) => s.keyword === kw)) continue;
        suggestions.push({
          keyword: kw,
          matchType: m.kind === 'longtail' ? 'phrase' : 'phrase',
          kind: m.kind,
          estimatedVolume: m.volume,
          estimatedCpc: Math.max(30, Math.round(avgCpc * m.cpcFactor)),
          priority: m.priority,
          rationale: m.why,
        });
        if (suggestions.length >= 18) break;
      }
      if (suggestions.length >= 18) break;
    }
    // 優先度で並べる
    const prio = { high: 0, mid: 1, low: 2 };
    suggestions.sort((a, b) => prio[a.priority] - prio[b.priority]);

    return { industryLabel: bm.label, suggestions };
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

    const efficiency = efficiencyScore({ ctr, cvr, cpa, roas, bm });
    const rec = recommendKeyword({ clicks, cost, conversions, cpa, roas, efficiency, bm });
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
