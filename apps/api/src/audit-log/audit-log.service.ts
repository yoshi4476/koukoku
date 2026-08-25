import { Injectable } from '@nestjs/common';
import type { AuditEventDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';

type Row = {
  id: string; userId: string | null; action: string; resource: string;
  detail: unknown; ip: string; createdAt: Date;
};

/**
 * 監査ログ閲覧 (F-50)。既存の操作証跡 (audit_trail / F-10) を読み取り、UI表示用に整形する。
 * 記録は TrailService.record が担うため、本サービスは読み取り専用。
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    opts: { action?: string; limit?: number } = {},
  ): Promise<AuditEventDto[]> {
    const { rows, userNames } = await this.prisma.withTenant(tenantId, async (tx) => {
      const rows = (await tx.auditTrail.findMany({
        where: opts.action ? { action: opts.action } : {},
        orderBy: { createdAt: 'desc' },
        take: Math.min(opts.limit ?? 200, 500),
      })) as Row[];
      const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
      const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      const userNames = new Map(users.map((u) => [u.id, u.name]));
      return { rows, userNames };
    });
    return rows.map((r) => this.toDto(r, userNames));
  }

  private toDto(r: Row, names: Map<string, string>): AuditEventDto {
    const detail = (r.detail && typeof r.detail === 'object' ? r.detail : {}) as Record<string, unknown>;
    return {
      id: r.id,
      action: r.action,
      actorName: r.userId ? names.get(r.userId) ?? '担当者' : 'ADGRID',
      resource: r.resource,
      detail,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
