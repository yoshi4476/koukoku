import { Controller, Get } from '@nestjs/common';
import { ALL_PLATFORMS, PLATFORM_META } from '@adgrid/shared';
import type { ConnectionStatus, PortalCardDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';

@Controller('portal')
export class PortalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async portal(@TenantId() tenantId: string): Promise<PortalCardDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [connections, accounts] = await Promise.all([
        tx.mediaConnection.findMany({}),
        tx.adAccount.groupBy({ by: ['platform'], _count: { _all: true } }),
      ]);
      const connMap = new Map(connections.map((c) => [c.platform, c]));
      const countMap = new Map(accounts.map((a) => [a.platform, a._count._all]));
      return ALL_PLATFORMS.map((p) => {
        const meta = PLATFORM_META[p];
        const conn = connMap.get(p);
        return {
          platform: p,
          label: meta.label,
          brandColor: meta.brandColor,
          adminUrl: meta.adminUrl,
          helpUrl: meta.helpUrl,
          developerUrl: meta.developerUrl,
          apiAvailability: meta.apiAvailability,
          connectionStatus: (conn?.status ?? 'not_connected') as ConnectionStatus,
          lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
          accountCount: countMap.get(p) ?? 0,
        };
      });
    });
  }
}
