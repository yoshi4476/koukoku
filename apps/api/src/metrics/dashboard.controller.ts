import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
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
    @Query('clientId') clientId?: string,
    @Query('platform') platform?: string,
    @Query('days') daysStr?: string,
  ): Promise<DashboardDto> {
    const days = Math.min(Math.max(Number(daysStr ?? 7) || 7, 1), 90);
    const until = daysAgo(0);
    const since = daysAgo(days - 1);
    const prevUntil = daysAgo(days);
    const prevSince = daysAgo(days * 2 - 1);
    const filter = { clientId: clientId || undefined, platform: platform || undefined };

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
}
