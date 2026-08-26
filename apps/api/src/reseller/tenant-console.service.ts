import { HttpStatus, Injectable } from '@nestjs/common';
import type { Edition, TenantConsoleDto, TenantUsageDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import type { SessionInfoValue } from '../common/tenant';
import { daysAgo } from '../metrics/metrics.service';

/**
 * テナント横断管理コンソール (F-60)。
 * 発行済みの提供先テナントを1画面で把握し、停止・再開まで行う。
 *
 * 各テナントの業務データは RLS で分離されているため、集計は
 * 「テナントごとに withTenant で入って数える」方式で行う。
 * 親が子を覗くのではなく、親が発行した子だけを対象にする点が重要。
 */
@Injectable()
export class TenantConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  private assertManager(user: SessionInfoValue) {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new AppError(HttpStatus.FORBIDDEN, 'テナント管理の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
  }

  /** 親が発行した子テナントであることを確認する (他人のテナントを操作させない) */
  private async assertOwnChild(parentTenantId: string, childId: string) {
    const child = await this.prisma.withTenant(parentTenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: childId } }),
    );
    if (!child || child.parentTenantId !== parentTenantId) {
      throw new AppError(HttpStatus.NOT_FOUND, 'テナントが見つかりません。', '一覧から選び直してください。');
    }
    return child;
  }

  async console(parentTenantId: string, user: SessionInfoValue): Promise<TenantConsoleDto> {
    this.assertManager(user);
    const children = await this.prisma.withTenant(parentTenantId, (tx) =>
      tx.tenant.findMany({ where: { parentTenantId }, orderBy: { createdAt: 'desc' } }),
    );

    const since = daysAgo(29);
    const until = daysAgo(0);
    const tenants: TenantUsageDto[] = [];

    for (const c of children) {
      const owner = await this.prisma.tenantMember.findFirst({
        where: { tenantId: c.id, role: 'owner' },
        include: { user: true },
      });
      const userCount = await this.prisma.tenantMember.count({ where: { tenantId: c.id } });

      // 子テナントの文脈に入って集計する (RLSを効かせたまま数える)
      const usage = await this.prisma.withTenant(c.id, async (tx) => {
        const [clientCount, projectCount, accountCount] = await Promise.all([
          tx.client.count(),
          tx.project.count(),
          tx.adAccount.count(),
        ]);
        const metrics = await tx.factAdPerformance.aggregate({
          where: { date: { gte: since, lte: until } },
          _sum: { cost: true, conversions: true },
        });
        const ai = await tx.llmCall.aggregate({
          where: { createdAt: { gte: since } },
          _sum: { costJpy: true },
        });
        const lastTrail = await tx.auditTrail.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        return {
          clientCount, projectCount, accountCount,
          cost: Number(metrics._sum.cost ?? 0),
          conversions: Number(metrics._sum.conversions ?? 0),
          aiCost: Number(ai._sum.costJpy ?? 0),
          lastActiveAt: lastTrail?.createdAt ?? null,
        };
      });

      tenants.push({
        id: c.id,
        name: c.name,
        edition: (c.edition as Edition) ?? 'client',
        status: c.status,
        adminEmail: owner?.user.email ?? '',
        createdAt: c.createdAt.toISOString(),
        clientCount: usage.clientCount,
        projectCount: usage.projectCount,
        accountCount: usage.accountCount,
        userCount,
        cost30d: Math.round(usage.cost),
        conversions30d: +usage.conversions.toFixed(1),
        aiCostJpy30d: +usage.aiCost.toFixed(2),
        lastActiveAt: usage.lastActiveAt?.toISOString() ?? null,
        // 立ち上がり判定: クライアントが登録され、広告アカウントも繋がっている
        onboarded: usage.clientCount > 0 && usage.accountCount > 0,
      });
    }

    return {
      tenants,
      totals: {
        tenantCount: tenants.length,
        activeCount: tenants.filter((t) => t.status === 'active').length,
        suspendedCount: tenants.filter((t) => t.status !== 'active').length,
        clientCount: tenants.reduce((s, t) => s + t.clientCount, 0),
        cost30d: tenants.reduce((s, t) => s + t.cost30d, 0),
        aiCostJpy30d: +tenants.reduce((s, t) => s + t.aiCostJpy30d, 0).toFixed(2),
      },
    };
  }

  /** 提供先テナントの利用を停止/再開する。停止するとそのテナントの全員がログインできなくなる */
  async setStatus(parentTenantId: string, user: SessionInfoValue, childId: string, status: 'active' | 'suspended'): Promise<{ ok: true; status: string }> {
    this.assertManager(user);
    await this.assertOwnChild(parentTenantId, childId);
    await this.prisma.withTenant(parentTenantId, (tx) =>
      tx.tenant.update({ where: { id: childId }, data: { status } }),
    );
    await this.trail.record({
      tenantId: parentTenantId,
      userId: user.userId,
      action: status === 'active' ? 'tenant_resumed' : 'tenant_suspended',
      resource: childId,
    });
    return { ok: true, status };
  }
}
