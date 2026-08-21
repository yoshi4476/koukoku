import { Controller, Get, Param } from '@nestjs/common';
import type { AdAccountDto, ClientDto, ConnectionStatus, Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';

@Controller('clients')
export class ClientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@TenantId() tenantId: string): Promise<ClientDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const clients = await tx.client.findMany({
        where: { status: 'active' },
        include: { _count: { select: { adAccounts: true } } },
        orderBy: { name: 'asc' },
      });
      return clients.map((c) => ({
        id: c.id,
        name: c.name,
        industryCode: c.industryCode,
        status: c.status as ClientDto['status'],
        accountCount: c._count.adAccounts,
      }));
    });
  }

  @Get(':clientId/accounts')
  async accounts(
    @TenantId() tenantId: string,
    @Param('clientId') clientId: string,
  ): Promise<AdAccountDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [accounts, connections] = await Promise.all([
        tx.adAccount.findMany({ where: { clientId }, orderBy: { name: 'asc' } }),
        tx.mediaConnection.findMany({}),
      ]);
      const connMap = new Map(connections.map((c) => [c.platform, c]));
      return accounts.map((a) => {
        const conn = connMap.get(a.platform);
        return {
          id: a.id,
          clientId: a.clientId,
          platform: a.platform as Platform,
          externalAccountId: a.externalAccountId,
          name: a.name,
          currency: a.currency,
          connectionStatus: (conn?.status ?? 'not_connected') as ConnectionStatus,
          lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
        };
      });
    });
  }
}
