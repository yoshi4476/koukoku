import { Controller, Get } from '@nestjs/common';
import type { MemberDto, MemberRole, UsageDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';

@Controller('usage')
export class UsageController {
  constructor(private readonly prisma: PrismaService) {}

  /** 当月のLLM利用量 (F-09 原価計測の利用者向けビュー) */
  @Get()
  async usage(@TenantId() tenantId: string): Promise<UsageDto> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.llmCall.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: monthStart } },
        _sum: { costJpy: true },
        _count: { _all: true },
      });
      const byFeature = rows.map((r) => ({
        feature: r.feature,
        costJpy: Number(r._sum.costJpy ?? 0),
        count: r._count._all,
      }));
      return {
        monthCostJpy: +byFeature.reduce((a, b) => a + b.costJpy, 0).toFixed(2),
        monthCallCount: byFeature.reduce((a, b) => a + b.count, 0),
        byFeature,
        mockedNote: !process.env.ANTHROPIC_API_KEY,
      };
    });
  }

  /** テナントのメンバー一覧 (設定画面用)。認証テーブルはRLS外のためアプリ層でテナント絞り込み */
  @Get('members')
  async members(@TenantId() tenantId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.tenantMember.findMany({
      where: { tenantId },
      include: { user: true },
      orderBy: { role: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role as MemberRole,
    }));
  }
}
