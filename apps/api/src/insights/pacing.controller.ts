import { Controller, Get } from '@nestjs/common';
import type { PacingDto, Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { MetricsService, daysAgo, isoDate, startOfDay } from '../metrics/metrics.service';

@Controller('pacing')
export class PacingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** 予算ペーシング予測 (B-4)。月予算のあるアカウントの着地予測と推奨日予算 */
  @Get()
  async pacing(@TenantId() tenantId: string): Promise<PacingDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const accounts = await tx.adAccount.findMany({
        where: { monthlyBudget: { not: null } },
        include: { client: true },
      });

      const now = new Date();
      const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
      const dayOfMonth = now.getUTCDate();
      const daysLeft = daysInMonth - dayOfMonth;
      const monthStart = startOfDay(now);
      monthStart.setUTCDate(1);

      const out: PacingDto[] = [];
      for (const acc of accounts) {
        const budget = Number(acc.monthlyBudget);
        if (budget <= 0) continue;
        const mtd = await this.metrics.totals(tx, { adAccountId: acc.id }, monthStart, daysAgo(0));
        const dailyAvg = mtd.cost / dayOfMonth;
        const projectedMonthEnd = dailyAvg * daysInMonth;
        const projectedPct = +((projectedMonthEnd / budget) * 100).toFixed(0);
        // 予算内に収める推奨日予算 (残予算 ÷ 残日数)
        const remainingBudget = Math.max(0, budget - mtd.cost);
        const recommendedDailyBudget = daysLeft > 0 ? Math.round(remainingBudget / daysLeft) : 0;

        let status: PacingDto['status'] = 'on_track';
        if (projectedPct > 110) status = 'over';
        else if (projectedPct < 90) status = 'under';

        // 予算枯渇予測日 (超過ペース時のみ)
        let runOutDate: string | null = null;
        if (status === 'over' && dailyAvg > 0) {
          const daysToRunOut = Math.ceil(remainingBudget / dailyAvg);
          if (daysToRunOut <= daysLeft) {
            const d = daysAgo(0);
            d.setUTCDate(d.getUTCDate() + daysToRunOut);
            runOutDate = isoDate(d);
          }
        }

        out.push({
          adAccountId: acc.id,
          accountName: acc.name,
          clientName: acc.client.name,
          platform: acc.platform as Platform,
          monthlyBudget: budget,
          monthToDateCost: Math.round(mtd.cost),
          projectedMonthEnd: Math.round(projectedMonthEnd),
          projectedPct,
          recommendedDailyBudget,
          currentDailyAvg: Math.round(dailyAvg),
          status,
          runOutDate,
          daysLeft,
        });
      }
      // 逸脱の大きい順 (100%からの乖離)
      return out.sort((a, b) => Math.abs(b.projectedPct - 100) - Math.abs(a.projectedPct - 100));
    });
  }
}
