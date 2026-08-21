import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuditRunDto, FindingStatus } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { AuditService } from './audit.service';

@Controller('audits')
export class AuditController {
  constructor(private readonly audits: AuditService) {}

  @Post('run')
  run(@TenantId() tenantId: string, @Body() body: { adAccountId?: string }): Promise<AuditRunDto> {
    if (!body?.adAccountId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '診断対象のアカウントが指定されていません。',
        'アカウントを選択してから「診断を実行」をクリックしてください。',
      );
    }
    return this.audits.run(tenantId, body.adAccountId);
  }

  @Get()
  list(@TenantId() tenantId: string, @Query('adAccountId') adAccountId?: string): Promise<AuditRunDto[]> {
    return this.audits.list(tenantId, adAccountId || undefined);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string): Promise<AuditRunDto> {
    return this.audits.get(tenantId, id);
  }

  @Patch(':id/findings/:rank')
  setStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('rank') rank: string,
    @Body() body: { status?: FindingStatus },
  ): Promise<AuditRunDto> {
    const status = body?.status;
    if (status !== 'open' && status !== 'adopted' && status !== 'dismissed') {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'ステータスの値が不正です。',
        'open / adopted / dismissed のいずれかを指定してください。',
      );
    }
    return this.audits.setFindingStatus(tenantId, id, Number(rank), status);
  }
}
