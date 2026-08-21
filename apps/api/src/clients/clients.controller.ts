import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import type {
  AdAccountDto,
  AuditResult,
  ClientDto,
  ClientOverviewDto,
  ConnectionStatus,
  Platform,
} from '@adgrid/shared';
import { ALL_PLATFORMS } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** クライアント管理画面用の俯瞰 (直近7日KPI・未対応指摘・最終レポート) */
  @Get('overview')
  async overview(@TenantId() tenantId: string): Promise<ClientOverviewDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const clients = await tx.client.findMany({
        where: { status: 'active' },
        include: { _count: { select: { adAccounts: true } } },
        orderBy: { name: 'asc' },
      });
      const out: ClientOverviewDto[] = [];
      for (const c of clients) {
        const [cur, prev, lastReport, audits] = await Promise.all([
          this.metrics.totals(tx, { clientId: c.id }, daysAgo(6), daysAgo(0)),
          this.metrics.totals(tx, { clientId: c.id }, daysAgo(13), daysAgo(7)),
          tx.report.findFirst({ where: { clientId: c.id }, orderBy: { createdAt: 'desc' } }),
          tx.audit.findMany({
            where: { adAccount: { clientId: c.id } },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
        ]);
        // アカウント毎の最新診断だけを対象に未対応指摘を数える
        const seen = new Set<string>();
        let openFindings = 0;
        for (const a of audits) {
          if (seen.has(a.adAccountId)) continue;
          seen.add(a.adAccountId);
          const statuses = (a.findingStatuses ?? {}) as Record<string, string>;
          for (const f of (a.result as unknown as AuditResult).findings ?? []) {
            if ((statuses[String(f.priority_rank)] ?? 'open') === 'open') openFindings++;
          }
        }
        const cpa = cur.conversions > 0 ? Math.round(cur.cost / cur.conversions) : null;
        const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
        out.push({
          client: {
            id: c.id,
            name: c.name,
            industryCode: c.industryCode,
            status: c.status as ClientDto['status'],
            accountCount: c._count.adAccounts,
          },
          cost7d: cur.cost,
          conversions7d: +cur.conversions.toFixed(1),
          cpa7d: cpa,
          cpaDelta:
            cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
          openFindings,
          lastReportAt: lastReport?.createdAt.toISOString() ?? null,
        });
      }
      return out;
    });
  }

  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body() body: { name?: string; industryCode?: string },
  ): Promise<ClientDto> {
    if (!body?.name?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'クライアント名が未入力です。',
        'クライアント名 (例: 株式会社サンプル) を入力してください。',
      );
    }
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.create({
        data: { tenantId, name: body.name!.trim(), industryCode: body.industryCode ?? 'other' },
      }),
    );
    return {
      id: client.id,
      name: client.name,
      industryCode: client.industryCode,
      status: 'active',
      accountCount: 0,
    };
  }

  @Post(':clientId/accounts')
  async createAccount(
    @TenantId() tenantId: string,
    @Param('clientId') clientId: string,
    @Body() body: { platform?: Platform; name?: string; monthlyBudget?: number },
  ): Promise<AdAccountDto> {
    if (!body?.platform || !ALL_PLATFORMS.includes(body.platform)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '媒体が選択されていません。',
        '媒体 (Google広告など) を選択してください。',
      );
    }
    const account = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      return tx.adAccount.create({
        data: {
          tenantId,
          clientId,
          platform: body.platform!,
          externalAccountId: 'manual',
          name: body.name?.trim() || `${client.name} ${body.platform}`,
          monthlyBudget: body.monthlyBudget ?? null,
        },
      });
    });
    return {
      id: account.id,
      clientId: account.clientId,
      platform: account.platform as Platform,
      externalAccountId: account.externalAccountId,
      name: account.name,
      currency: account.currency,
      connectionStatus: 'not_connected',
      lastSyncedAt: null,
    };
  }

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
