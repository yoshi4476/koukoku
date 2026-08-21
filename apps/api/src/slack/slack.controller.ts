import { Body, Controller, Headers, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';

/**
 * Slackスラッシュコマンド (B-6)。既存のSlack通知基盤を双方向化する。
 * `/adgrid help` `/adgrid summary` `/adgrid alerts` に応答。
 *
 * 設定: Slack App の Slash Command のリクエストURLをこのエンドポイントに向け、
 * SLACK_SIGNING_SECRET を設定する。テナントの紐付けは Slack workspace ID →
 * tenant.settings.slackTeamId で行う (本実装では簡易に DEV_TENANT_ID フォールバック)。
 */
@Controller('slack')
export class SlackController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Post('command')
  async command(
    @Req() req: Request,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
    @Body() body: { command?: string; text?: string; team_id?: string },
  ): Promise<{ response_type: string; text: string }> {
    this.verifySignature(req, signature, timestamp);

    // Slack workspace → テナント解決 (未設定時は開発用フォールバック)
    const tenantId = await this.resolveTenant(body.team_id);
    if (!tenantId) {
      return this.msg('このSlackワークスペースはADGRIDと連携されていません。設定画面から連携してください。');
    }

    const sub = (body.text ?? '').trim().split(/\s+/)[0] || 'help';
    switch (sub) {
      case 'summary':
        return this.summary(tenantId);
      case 'alerts':
        return this.alerts(tenantId);
      case 'help':
      default:
        return this.msg(
          '*ADGRID コマンド*\n' +
            '`/adgrid summary` — 全クライアントの直近7日サマリ\n' +
            '`/adgrid alerts` — 未確認アラート\n' +
            '`/adgrid help` — このヘルプ',
        );
    }
  }

  private async summary(tenantId: string): Promise<{ response_type: string; text: string }> {
    const text = await this.prisma.withTenant(tenantId, async (tx) => {
      const cur = await this.metrics.totals(tx, {}, daysAgo(6), daysAgo(0));
      const prev = await this.metrics.totals(tx, {}, daysAgo(13), daysAgo(7));
      const cpa = cur.conversions > 0 ? Math.round(cur.cost / cur.conversions) : null;
      const costDelta = prev.cost > 0 ? Math.round(((cur.cost - prev.cost) / prev.cost) * 100) : 0;
      return (
        '*直近7日サマリ (全クライアント)*\n' +
        `消化額: ¥${Math.round(cur.cost).toLocaleString('ja-JP')} (前週比 ${costDelta >= 0 ? '+' : ''}${costDelta}%)\n` +
        `CV: ${cur.conversions.toFixed(0)}件\n` +
        `CPA: ${cpa !== null ? '¥' + cpa.toLocaleString('ja-JP') : '—'}`
      );
    });
    return this.msg(text);
  }

  private async alerts(tenantId: string): Promise<{ response_type: string; text: string }> {
    const text = await this.prisma.withTenant(tenantId, async (tx) => {
      const events = await tx.alertEvent.findMany({
        where: { ackedAt: null },
        orderBy: { firedAt: 'desc' },
        take: 5,
        include: { rule: true },
      });
      if (events.length === 0) return '未確認のアラートはありません 🎉';
      return (
        `*未確認アラート ${events.length}件*\n` +
        events.map((e) => `${e.severity === 'bad' ? '🔴' : '🟡'} ${e.title}`).join('\n')
      );
    });
    return this.msg(text);
  }

  private async resolveTenant(teamId?: string): Promise<string | null> {
    if (teamId) {
      // tenant.settings.slackTeamId で紐付け (管理者接続で全テナント横断検索)
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'active' } });
      const match = tenants.find((t) => (t.settings as Record<string, unknown>)?.slackTeamId === teamId);
      if (match) return match.id;
    }
    return process.env.DEV_TENANT_ID ?? null;
  }

  /** Slack署名検証 (SLACK_SIGNING_SECRET 設定時のみ。未設定の開発環境ではスキップ) */
  private verifySignature(req: Request, signature: string, timestamp: string): void {
    const secret = process.env.SLACK_SIGNING_SECRET;
    if (!secret) return; // 開発環境: 検証スキップ
    if (!signature || !timestamp) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Slack署名がありません。', 'Slackからのリクエストのみ受け付けます。');
    }
    // リプレイ防止: 5分以上前のリクエストは拒否
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'リクエストが古すぎます。', '再試行してください。');
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString() ?? '';
    const base = `v0:${timestamp}:${raw}`;
    const hmac = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Slack署名が一致しません。', 'Signing Secret の設定を確認してください。');
    }
  }

  private msg(text: string): { response_type: string; text: string } {
    return { response_type: 'ephemeral', text };
  }
}
