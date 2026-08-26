import { Injectable } from '@nestjs/common';
import type { PacingDto, Platform } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { MetricsService, daysAgo, isoDate, startOfDay } from '../metrics/metrics.service';

/** 予算ペーシング予測 (B-4)。月予算のあるアカウントの着地予測と推奨日予算を算出する */
@Injectable()
export class PacingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async compute(tenantId: string): Promise<PacingDto[]> {
    return this.prisma.withTenant(tenantId, (tx) => this.computeIn(tx));
  }

  async computeIn(tx: Tx): Promise<PacingDto[]> {
    const accounts = await tx.adAccount.findMany({
      where: { monthlyBudget: { not: null } },
      include: { client: true },
    });

    const now = new Date();
    // 日付は metrics 規約 (startOfDay=ローカル暦日をUTC深夜に固定) に揃える。
    // monthStart はローカル暦日基準なので、daysInMonth/dayOfMonth も getUTC* ではなく
    // ローカルフィールドで数えないと、非UTCサーバ(JST)で月初/月末に予算計算が1日ずれる
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
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
      const remainingBudget = Math.max(0, budget - mtd.cost);
      const recommendedDailyBudget = daysLeft > 0 ? Math.round(remainingBudget / daysLeft) : 0;

      let status: PacingDto['status'] = 'on_track';
      if (projectedPct > 110) status = 'over';
      else if (projectedPct < 90) status = 'under';

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
    return out.sort((a, b) => Math.abs(b.projectedPct - 100) - Math.abs(a.projectedPct - 100));
  }
}
