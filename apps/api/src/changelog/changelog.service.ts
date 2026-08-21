import { Injectable, Logger } from '@nestjs/common';
import type { ChangeLogDto, Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface ChangeInput {
  tenantId: string;
  adAccountId: string;
  actor: 'adgrid' | 'media_console' | 'api';
  actorName?: string;
  entity: string;
  field: string;
  oldValue?: string;
  newValue?: string;
  note?: string;
}

/**
 * 変更履歴 (B-2)。ADGRID経由の変更 (承認実行) と媒体側変更を統合記録する。
 * 記録の失敗で業務処理を止めない (ログに留める)。
 */
@Injectable()
export class ChangeLogService {
  private readonly logger = new Logger(ChangeLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ChangeInput): Promise<void> {
    try {
      await this.prisma.withTenant(input.tenantId, (tx) =>
        tx.changeLog.create({
          data: {
            tenantId: input.tenantId,
            adAccountId: input.adAccountId,
            actor: input.actor,
            actorName: input.actorName ?? '',
            entity: input.entity,
            field: input.field,
            oldValue: input.oldValue ?? '',
            newValue: input.newValue ?? '',
            note: input.note ?? '',
          },
        }),
      );
    } catch (e) {
      this.logger.warn(`change log write failed: ${String(e)}`);
    }
  }

  async list(tenantId: string, adAccountId?: string, clientId?: string): Promise<ChangeLogDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.changeLog.findMany({
        where: {
          ...(adAccountId ? { adAccountId } : {}),
          ...(clientId ? { adAccount: { clientId } } : {}),
        },
        orderBy: { changedAt: 'desc' },
        take: 100,
        include: { adAccount: { include: { client: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        adAccountId: r.adAccountId,
        accountName: r.adAccount.name,
        clientName: r.adAccount.client.name,
        platform: r.adAccount.platform as Platform,
        changedAt: r.changedAt.toISOString(),
        actor: r.actor as ChangeLogDto['actor'],
        actorName: r.actorName,
        entity: r.entity,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        note: r.note,
      }));
    });
  }
}
