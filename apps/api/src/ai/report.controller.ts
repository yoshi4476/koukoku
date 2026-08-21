import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ReportRunDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ReportExportService } from '../exports/report-export.service';
import { ReportService } from './report.service';

function attachmentHeaders(res: Response, filename: string, mime: string) {
  res.setHeader('Content-Type', mime);
  // 日本語ファイル名は RFC 5987 (filename*) + ASCIIフォールバック
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="report.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
}

@Controller('reports')
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly scheduler: SchedulerService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get(':id/pdf')
  async pdf(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.exporter.load(tenantId, id);
    const buf = await this.exporter.toPdf(tenantId, id);
    attachmentHeaders(res, `ADGRID_${report.clientName}_${report.periodStart}.pdf`, 'application/pdf');
    res.end(buf);
  }

  @Get(':id/pptx')
  async pptx(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.exporter.load(tenantId, id);
    const buf = await this.exporter.toPptx(tenantId, id);
    attachmentHeaders(
      res,
      `ADGRID_${report.clientName}_${report.periodStart}.pptx`,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    res.end(buf);
  }

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
