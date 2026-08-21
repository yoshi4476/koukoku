import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import type { ReportRunDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ReportService } from './report.service';

@Controller('reports')
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly scheduler: SchedulerService,
  ) {}

  /** スケジューラの手動実行 (開発・検証用)。本番は週次cronで自動実行 */
  @Post('run-weekly-all')
  runWeeklyAll(@TenantId() _tenantId: string) {
    return this.scheduler.runWeeklyForAllTenants();
  }

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
