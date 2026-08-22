import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { DailyPointDto, PublicPortalDto, ShareLinkDto } from '@adgrid/shared';
import { industryProfileFor } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';

/**
 * クライアント共有ライブポータル (F-41)。
 * 自社が発行した token で、ログイン不要の閲覧専用ダッシュボードを開ける。
 * share_links は RLS 無し(token が秘密)。クエリは必ず tenant/client/token で絞る。
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** 現在の共有状態を返す (自社側) */
  async status(tenantId: string, clientId: string): Promise<ShareLinkDto> {
    const link = await this.prisma.shareLink.findUnique({ where: { tenantId_clientId: { tenantId, clientId } } });
    return { token: link?.enabled ? link.token : null, enabled: !!link?.enabled, createdAt: link?.createdAt.toISOString() ?? null };
  }

  /** 共有リンクを発行(または再有効化)する */
  async enable(tenantId: string, clientId: string): Promise<ShareLinkDto> {
    const client = await this.prisma.withTenant(tenantId, (tx) => tx.client.findUnique({ where: { id: clientId } }));
    if (!client) {
      throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
    }
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
    const link = await this.prisma.shareLink.upsert({
      where: { tenantId_clientId: { tenantId, clientId } },
      update: { enabled: true, token },
      create: { tenantId, clientId, token, enabled: true },
    });
    return { token: link.token, enabled: true, createdAt: link.createdAt.toISOString() };
  }

  /** 共有を停止する (リンクを無効化) */
  async disable(tenantId: string, clientId: string): Promise<ShareLinkDto> {
    await this.prisma.shareLink.updateMany({ where: { tenantId, clientId }, data: { enabled: false } });
    return { token: null, enabled: false, createdAt: null };
  }

  /** 公開ポータルのデータ (ログイン不要)。token → tenant/client を解決し、その1社分のみ返す */
  async publicPortal(token: string): Promise<PublicPortalDto> {
    const link = await this.prisma.shareLink.findUnique({ where: { token } });
    if (!link || !link.enabled) {
      throw new AppError(HttpStatus.NOT_FOUND, '共有リンクが無効です。', 'リンクの発行者にお問い合わせください。');
    }
    return this.prisma.withTenant(link.tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: link.clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'データが見つかりません。', 'リンクの発行者にお問い合わせください。');
      }
      const [cur, trend, projects] = await Promise.all([
        this.metrics.totals(tx, { clientId: client.id }, daysAgo(29), daysAgo(0)),
        this.metrics.dailyTrend(tx, { clientId: client.id }, daysAgo(29), daysAgo(0)),
        tx.project.findMany({ where: { clientId: client.id }, include: { adAccounts: { select: { id: true } } }, orderBy: { createdAt: 'desc' } }),
      ]);
      const projItems: PublicPortalDto['projects'] = [];
      for (const p of projects) {
        const ids = p.adAccounts.map((a) => a.id);
        const t = ids.length ? await this.metrics.totals(tx, { adAccountIds: ids }, daysAgo(29), daysAgo(0)) : { cost: 0, conversions: 0, impressions: 0, clicks: 0, conversionValue: 0 };
        projItems.push({ name: p.name, cost: Math.round(t.cost), conversions: +t.conversions.toFixed(1), cpa: t.conversions > 0 ? Math.round(t.cost / t.conversions) : null });
      }
      const kpi = {
        cost: Math.round(cur.cost),
        conversions: +cur.conversions.toFixed(1),
        cpa: cur.conversions > 0 ? Math.round(cur.cost / cur.conversions) : null,
        roas: cur.cost > 0 ? Math.round((cur.conversionValue / cur.cost) * 100) : null,
      };
      return {
        clientName: client.name,
        industryLabel: industryProfileFor(client.industryCode).label,
        periodLabel: '直近30日',
        kpi,
        trend: trend as DailyPointDto[],
        projects: projItems,
        generatedAt: new Date().toISOString(),
      };
    });
  }
}
