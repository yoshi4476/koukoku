import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 操作証跡 (F-10)。追記専用テーブルへ記録する。
 * 証跡の失敗で業務処理を止めないため、エラーはログに留める。
 * テナント未確定の事象 (不明メールでのログイン失敗等) はアプリログが担う。
 */
@Injectable()
export class TrailService {
  private readonly logger = new Logger(TrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    tenantId: string;
    userId?: string | null;
    action: string;
    resource?: string;
    detail?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    try {
      await this.prisma.withTenant(input.tenantId, (tx) =>
        tx.auditTrail.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            action: input.action,
            resource: input.resource ?? '',
            detail: (input.detail ?? {}) as object,
            ip: input.ip ?? '',
          },
        }),
      );
    } catch (e) {
      this.logger.warn(`audit trail write failed: ${String(e)}`);
    }
  }
}
