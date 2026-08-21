import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import type { BenchmarkDto } from '@adgrid/shared';
import { benchmarkFor, verdictHigherBetter, verdictLowerBetter } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';

@Controller('benchmark')
export class BenchmarkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** クライアントの直近30日実績を業種ベンチマークと比較する (A-3) */
  @Get()
  async benchmark(
    @TenantId() tenantId: string,
    @Query('clientId') clientId?: string,
  ): Promise<BenchmarkDto> {
    if (!clientId) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'クライアントが指定されていません。', 'クライアントを選択してください。');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      const t = await this.metrics.totals(tx, { clientId }, daysAgo(29), daysAgo(0));
      const ctr = t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null;
      const cvr = t.clicks > 0 ? +((t.conversions / t.clicks) * 100).toFixed(2) : null;
      const cpa = t.conversions > 0 ? Math.round(t.cost / t.conversions) : null;
      const bm = benchmarkFor(client.industryCode);
      return {
        industryCode: bm.code,
        industryLabel: bm.label,
        metrics: {
          ctr: { value: ctr, benchmark: bm.ctr, verdict: verdictHigherBetter(ctr, bm.ctr) },
          cvr: { value: cvr, benchmark: bm.cvr, verdict: verdictHigherBetter(cvr, bm.cvr) },
          cpa: { value: cpa, benchmark: bm.cpa, verdict: verdictLowerBetter(cpa, bm.cpa) },
        },
      };
    });
  }
}
