import { Controller, Get, Query } from '@nestjs/common';
import type { CampaignBreakdownDto, DashboardDto, Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClientScope, TenantId } from '../common/tenant';
import { MetricsService, daysAgo, isoDate } from './metrics.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  async dashboard(
    @TenantId() tenantId: string,
    @ClientScope() scope: string | null,
    @Query('clientId') clientId?: string,
    @Query('platform') platform?: string,
    @Query('days') daysStr?: string,
  ): Promise<DashboardDto> {
    const days = Math.min(Math.max(Number(daysStr ?? 7) || 7, 1), 90);
    const until = daysAgo(0);
    const since = daysAgo(days - 1);
    const prevUntil = daysAgo(days);
    const prevSince = daysAgo(days * 2 - 1);
    // 提供先アクセスは自分のクライアントに強制固定
    const filter = { clientId: scope ?? clientId ?? undefined, platform: platform || undefined };

    return this.prisma.withTenant(tenantId, async (tx) => {
      const [cur, prev, trendCur, trendPrev, byPlatform] = await Promise.all([
        this.metrics.totals(tx, filter, since, until),
        this.metrics.totals(tx, filter, prevSince, prevUntil),
        this.metrics.dailyTrend(tx, filter, since, until),
        this.metrics.dailyTrend(tx, filter, prevSince, prevUntil),
        this.metrics.byPlatform(tx, filter, since, until, prevSince, prevUntil),
      ]);
      return {
        period: { since: isoDate(since), until: isoDate(until) },
        kpi: this.metrics.kpiFromTotals(cur, prev),
        trend: { current: trendCur, previous: trendPrev },
        byPlatform,
      };
    });
  }

  /** キャンペーン別ドリルダウン (媒体行クリックで展開) */
  @Get('campaigns')
  async campaigns(
    @TenantId() tenantId: string,
    @Query('clientId') clientId?: string,
    @Query('platform') platform?: string,
    @Query('days') daysStr?: string,
  ): Promise<CampaignBreakdownDto[]> {
    const days = Math.min(Math.max(Number(daysStr ?? 7) || 7, 1), 90);
    const until = daysAgo(0);
    const since = daysAgo(days - 1);
    const prevUntil = daysAgo(days);
    const prevSince = daysAgo(days * 2 - 1);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = (s: Date, u: Date) => ({
        date: { gte: s, lte: u },
        ...(platform ? { platform } : {}),
        ...(clientId ? { adAccount: { clientId } } : {}),
      });
      const group = (s: Date, u: Date) =>
        tx.factAdPerformance.groupBy({
          by: ['campaignId', 'campaignName', 'platform'],
          where: where(s, u),
          _sum: { cost: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
        });
      const [cur, prev] = await Promise.all([group(since, until), group(prevSince, prevUntil)]);
      const prevMap = new Map(prev.map((p) => [`${p.platform}|${p.campaignId}`, p]));
      return cur
        .map((r) => {
          const cost = Number(r._sum.cost ?? 0);
          const clicks = Number(r._sum.clicks ?? 0);
          const impressions = Number(r._sum.impressions ?? 0);
          const conversions = Number(r._sum.conversions ?? 0);
          const conversionValue = Number(r._sum.conversionValue ?? 0);
          const p = prevMap.get(`${r.platform}|${r.campaignId}`);
          const prevCost = Number(p?._sum.cost ?? 0);
          const prevConv = Number(p?._sum.conversions ?? 0);
          const cpa = conversions > 0 ? Math.round(cost / conversions) : null;
          const prevCpa = prevConv > 0 ? prevCost / prevConv : null;
          return {
            campaignId: r.campaignId,
            campaignName: r.campaignName || '(キャンペーン未設定)',
            platform: r.platform as Platform,
            cost,
            impressions,
            clicks,
            conversions: +conversions.toFixed(1),
            ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null,
            cpa,
            roas: cost > 0 ? +((conversionValue / cost) * 100).toFixed(0) : null,
            cpaDelta:
              cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
          };
        })
        .sort((a, b) => b.cost - a.cost);
    });
  }
}
