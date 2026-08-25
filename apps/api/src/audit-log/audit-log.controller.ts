import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import type { AuditEventDto } from '@adgrid/shared';
import { isApprover } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { AuditLogService } from './audit-log.service';

/** 監査ログ閲覧 (F-50)。操作証跡はテナント機密のため owner/admin 限定 */
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Query('action') action?: string,
  ): Promise<AuditEventDto[]> {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '閲覧権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
    return this.audit.list(tenantId, { action: action || undefined });
  }
}
