import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import type { ReportRunDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { ReportService } from './report.service';

@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Post('run')
  run(
    @TenantId() tenantId: string,
    @Body() body: { clientId?: string; periodType?: 'weekly' | 'monthly' },
  ): Promise<ReportRunDto> {
    if (!body?.clientId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'クライアントが指定されていません。',
        'クライアントを選択してから「レポートを生成」をクリックしてください。',
      );
    }
    return this.reports.run(tenantId, body.clientId, body.periodType ?? 'weekly');
  }

  @Get()
  list(@TenantId() tenantId: string, @Query('clientId') clientId?: string): Promise<ReportRunDto[]> {
    return this.reports.list(tenantId, clientId || undefined);
  }
}
