import { Controller, Get, Query } from '@nestjs/common';
import type { ChangeLogDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { ChangeLogService } from './changelog.service';

@Controller('changelog')
export class ChangeLogController {
  constructor(private readonly changelog: ChangeLogService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('adAccountId') adAccountId?: string,
    @Query('clientId') clientId?: string,
  ): Promise<ChangeLogDto[]> {
    return this.changelog.list(tenantId, adAccountId || undefined, clientId || undefined);
  }
}
