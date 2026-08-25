import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Platform, SyncResultDto } from '@adgrid/shared';
import { PLATFORM_META } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { daysAgo, isoDate } from '../metrics/metrics.service';
import { PlatformConnector } from './core';
import { MockConnector } from './mock.connector';
import { GoogleAdsConnector } from './google-ads.connector';

/** アトリビューション変動を考慮し直近30日を毎回洗い替え (別冊D §⑤) */
const SYNC_WINDOW_DAYS = 30;

@Injectable()
export class MediaSyncService {
  private readonly logger = new Logger(MediaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  resolveConnector(platform: Platform, mode: 'mock' | 'oauth', tenantId?: string): PlatformConnector {
    if (mode === 'oauth' && platform === 'google_ads' && tenantId) {
      return new GoogleAdsConnector(this.prisma, tenantId);
    }
    return new MockConnector(platform);
  }

  /** 接続前の認可: 実API認証情報があれば oauth、なければデモ接続候補を返す */
  async authorize(tenantId: string, platform: Platform) {
    if (PLATFORM_META[platform].apiAvailability === 'partner_only') {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${PLATFORM_META[platform].label}のAPIは認定パートナー限定のため接続できません。`,
        'CSV取込で実績データを反映してください (データ取込画面)。パートナー申請は並行検討中です。',
      );
    }
    if (platform === 'google_ads' && GoogleAdsConnector.configured) {
      return new GoogleAdsConnector(this.prisma, tenantId).authorize(tenantId);
    }
    return new MockConnector(platform).authorize(tenantId);
  }

  /** 同期実行: 接続配下の全アカウントを30日洗い替えでUPSERT */
  async sync(tenantId: string, connectionId: string): Promise<SyncResultDto> {
    const conn = await this.prisma.withTenant(tenantId, (tx) =>
      tx.mediaConnection.findUnique({ where: { id: connectionId } }),
    );
    if (!conn || conn.status === 'not_connected') {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        '接続が見つかりません。',
        'API接続画面から媒体を接続してください。',
      );
    }
    const connector = this.resolveConnector(conn.platform as Platform, conn.mode as 'mock' | 'oauth', tenantId);
    const since = isoDate(daysAgo(SYNC_WINDOW_DAYS - 1));
    const until = isoDate(daysAgo(0));

    try {
      const accounts = await this.prisma.withTenant(tenantId, (tx) =>
        tx.adAccount.findMany({ where: { platform: conn.platform } }),
      );
      let totalRows = 0;
      for (const acc of accounts) {
        const rows = await connector.fetchReport(acc.externalAccountId, { since, until });
        await this.prisma.withTenant(tenantId, async (tx) => {
          await tx.factAdPerformance.deleteMany({
            where: {
              adAccountId: acc.id,
              date: { gte: new Date(since + 'T00:00:00Z'), lte: new Date(until + 'T00:00:00Z') },
            },
          });
          await tx.factAdPerformance.createMany({
            data: rows.map((r) => ({
              date: new Date(r.date + 'T00:00:00Z'),
              tenantId,
              adAccountId: acc.id,
              platform: conn.platform,
              campaignId: r.campaignId,
              campaignName: r.campaignName,
              adgroupId: '',
              adId: '',
              impressions: BigInt(r.impressions),
              clicks: BigInt(r.clicks),
              cost: r.cost,
              conversions: r.conversions,
              conversionValue: r.conversionValue,
              currency: acc.currency,
              extra: {},
            })),
          });
        });
        totalRows += rows.length;
      }
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.mediaConnection.update({
          where: { id: connectionId },
          data: { status: 'connected', lastSyncedAt: new Date(), lastSyncRows: totalRows, errorMessage: '' },
        }),
      );
      await this.trail.record({
        tenantId,
        action: 'media_sync',
        resource: conn.platform,
        detail: { connectionId, rows: totalRows, since, until },
      });
      return { rows: totalRows, since, until };
    } catch (e) {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.mediaConnection.update({
          where: { id: connectionId },
          data: { status: 'error', errorMessage: String(e).slice(0, 300) },
        }),
      );
      throw e;
    }
  }

  /** 全テナントの接続済みコネクションを同期 (3時間毎ジョブから呼ばれる) */
  async syncAllForTenant(tenantId: string): Promise<number> {
    const conns = await this.prisma.withTenant(tenantId, (tx) =>
      tx.mediaConnection.findMany({ where: { status: { in: ['connected', 'error'] } } }),
    );
    let ok = 0;
    for (const c of conns) {
      try {
        await this.sync(tenantId, c.id);
        ok++;
      } catch (e) {
        this.logger.warn(`sync failed tenant=${tenantId} conn=${c.id}: ${String(e)}`);
      }
    }
    return ok;
  }
}
