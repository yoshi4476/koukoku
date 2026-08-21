import { Controller, Get, Post } from '@nestjs/common';
import type { OnboardingStatusDto, SampleDataResultDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { AuditService } from '../ai/audit.service';
import { daysAgo } from '../metrics/metrics.service';

/** 決定的な擬似乱数 (seed と同方式。デモデータの再現性のため) */
function wave(dayIndex: number, salt: number): number {
  const x = Math.sin(dayIndex * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audits: AuditService,
  ) {}

  @Get('status')
  async status(@TenantId() tenantId: string): Promise<OnboardingStatusDto> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [clientCount, factCount, auditCount] = await Promise.all([
        tx.client.count(),
        tx.factAdPerformance.count(),
        tx.audit.count(),
      ]);
      return {
        needsOnboarding: clientCount === 0 || factCount === 0,
        clientCount,
        hasData: factCount > 0,
        hasAudit: auditCount > 0,
      };
    });
  }

  /**
   * 「サンプルデータで試す」(プロンプトE): サンプルクライアント+28日実績を作成し、
   * 初回診断まで自動実行してアハ体験に直行させる。
   */
  @Post('sample')
  async sample(@TenantId() tenantId: string): Promise<SampleDataResultDto> {
    const { clientId, adAccountId } = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.create({
        data: { tenantId, name: 'サンプル: 自社ECサイト', industryCode: 'ec' },
      });
      const account = await tx.adAccount.create({
        data: {
          tenantId,
          clientId: client.id,
          platform: 'google_ads',
          externalAccountId: 'sample',
          name: 'サンプル Google広告',
          monthlyBudget: 500000,
        },
      });
      // 直近7日でCPAが悪化するパターンを埋め込み、診断が具体的な提案を返せるようにする
      const rows = [];
      for (let day = 27; day >= 0; day--) {
        const date = daysAgo(day);
        const dow = date.getUTCDay();
        const weekendFactor = dow === 0 || dow === 6 ? 0.8 : 1.0;
        for (const c of [
          { id: 's-search', name: '検索キャンペーン', baseCost: 10000, ctr: 0.045, cvr: day < 7 ? 0.016 : 0.03, aov: 9000 },
          { id: 's-display', name: 'ディスプレイ', baseCost: 6000, ctr: 0.006, cvr: 0.01, aov: 9000 },
        ]) {
          const jitter = 0.85 + wave(day, c.baseCost) * 0.3;
          const cost = Math.round(c.baseCost * weekendFactor * jitter);
          const clicks = Math.max(1, Math.round(cost / (70 + wave(day, 3) * 50)));
          rows.push({
            date,
            tenantId,
            adAccountId: account.id,
            platform: 'google_ads',
            campaignId: c.id,
            campaignName: c.name,
            adgroupId: '',
            adId: '',
            impressions: BigInt(Math.round(clicks / c.ctr)),
            clicks: BigInt(clicks),
            cost,
            conversions: +(clicks * c.cvr).toFixed(1),
            conversionValue: Math.round(clicks * c.cvr * c.aov),
            currency: 'JPY',
            extra: {},
          });
        }
      }
      await tx.factAdPerformance.createMany({ data: rows });
      return { clientId: client.id, adAccountId: account.id };
    });

    const audit = await this.audits.run(tenantId, adAccountId);
    return { clientId, adAccountId, auditId: audit.id };
  }
}
