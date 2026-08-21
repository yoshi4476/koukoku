import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AlertChannel,
  AlertEventDto,
  AlertRuleDto,
  AlertRunResultDto,
  AlertSettingsDto,
} from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('rules')
  rules(@TenantId() tenantId: string): Promise<AlertRuleDto[]> {
    return this.alerts.getRules(tenantId);
  }

  @Patch('rules/:id')
  updateRule(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { threshold?: number; enabled?: boolean; channels?: AlertChannel[] },
  ): Promise<AlertRuleDto[]> {
    if (body?.threshold !== undefined && (!Number.isFinite(body.threshold) || body.threshold <= 0)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'しきい値は正の数値で入力してください。',
        '例: CPA急変なら 30 (=前週比+30%で通知)。',
      );
    }
    return this.alerts.updateRule(tenantId, id, body ?? {});
  }

  @Get('settings')
  settings(@TenantId() tenantId: string): Promise<AlertSettingsDto> {
    return this.alerts.getSettings(tenantId);
  }

  @Put('settings')
  updateSettings(
    @TenantId() tenantId: string,
    @Body() body: { slackWebhookUrl?: string },
  ): Promise<AlertSettingsDto> {
    const url = (body?.slackWebhookUrl ?? '').trim();
    if (url && !/^https:\/\/hooks\.slack\.com\//.test(url)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Slack Webhook URLの形式が正しくありません。',
        'https://hooks.slack.com/ から始まるIncoming Webhook URLを貼り付けてください。',
      );
    }
    return this.alerts.updateSettings(tenantId, url);
  }

  @Post('settings/test')
  async testSlack(@TenantId() tenantId: string): Promise<{ ok: boolean }> {
    const ok = await this.alerts.testSlack(tenantId);
    if (!ok) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'テスト通知を送信できませんでした。',
        'Slack Webhook URLを設定・保存してから再試行してください。',
      );
    }
    return { ok: true };
  }

  @Post('run')
  run(@TenantId() tenantId: string): Promise<AlertRunResultDto> {
    return this.alerts.runDetection(tenantId);
  }

  @Get('events')
  events(@TenantId() tenantId: string, @Query('limit') limit?: string): Promise<AlertEventDto[]> {
    return this.alerts.listEvents(tenantId, Number(limit ?? 50) || 50);
  }

  @Post('events/:id/ack')
  async ack(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
    const session = token ? verifySession(token) : null;
    await this.alerts.ackEvent(tenantId, id, session?.sub ?? null);
    return { ok: true };
  }
}
