import { Body, Controller, Headers, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';
import { AgentService } from '../agent/agent.service';

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
    private readonly agent: AgentService,
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

    const full = (body.text ?? '').trim();
    const sub = full.split(/\s+/)[0] || 'help';
    const rest = full.slice(sub.length).trim();
    switch (sub) {
      case 'summary':
        return this.summary(tenantId);
      case 'alerts':
        return this.alerts(tenantId);
      case 'agent':
      case 'run':
        return this.runAgent(tenantId, rest);
      case 'help':
      default:
        return this.msg(
          '*ADGRID コマンド*\n' +
            '`/adgrid agent <プロジェクト名> : <指示>` — AIが一気通貫で配信設定〜制作物を準備\n' +
            '　例: `/adgrid agent 春の新規獲得 : 月30万で獲得を増やして。女性25-44・首都圏`\n' +
            '`/adgrid summary` — 全クライアントの直近7日サマリ\n' +
            '`/adgrid alerts` — 未確認アラート\n' +
            '`/adgrid help` — このヘルプ',
        );
    }
  }

  /** Slackから AIエージェントを起動 (プロジェクト名で解決)。公開はシステム側の最終確認を残す */
  private async runAgent(tenantId: string, arg: string): Promise<{ response_type: string; text: string }> {
    const [q, ...instr] = arg.split(/[:：]/);
    const query = (q ?? '').trim();
    const instruction = instr.join(':').trim();
    if (!query || !instruction) {
      return this.msg('形式: `/adgrid agent <プロジェクト名> : <指示>`\n例: `/adgrid agent 春の新規獲得 : 月30万で獲得を増やして`');
    }
    const projects = await this.prisma.withTenant(tenantId, (tx) => tx.project.findMany({ select: { id: true, name: true } }));
    const matches = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    if (matches.length === 0) return this.msg(`「${query}」に一致するプロジェクトが見つかりません。`);
    if (matches.length > 1) return this.msg(`複数一致しました。もっと具体的に指定してください:\n${matches.map((m) => `・${m.name}`).join('\n')}`);

    const run = await this.agent.run(tenantId, matches[0].id, instruction, null);
    const stepLines = run.steps.map((s) => `• ${s.title}`).join('\n');
    const media = run.mediaPlan.map((m) => `${m.platformLabel} ${m.sharePct}%`).join(' / ');
    return this.msg(
      `*🤖 AIエージェント実行: ${matches[0].name}*\n` +
        `${stepLines}\n\n` +
        `*反映した配信設定*\n` +
        `月予算 ¥${(run.appliedSettings.monthlyBudgetTotal ?? 0).toLocaleString('ja-JP')} / 目標CPA ¥${(run.appliedSettings.targetCpa ?? 0).toLocaleString('ja-JP')} / ${run.appliedSettings.regions}・${run.appliedSettings.ageRange}\n` +
        `媒体配分: ${media}\n` +
        `制作物: ${run.createdAssetTitles.length}件を下書き生成（${run.mocked ? 'テンプレ' : 'AI'}）\n\n` +
        `▶ 公開はADGRIDの「制作物」→プレビュー→公開前チェックから最終確認してください。`,
    );
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
      // tenants はRLS対象。app.tenant_id 無しの通常接続では0件になるため、
      // withPlatformAdmin で全テナント横断検索する (これをしないと常にDEVフォールバックに落ちる)
      const tenants = await this.prisma.withPlatformAdmin((tx) => tx.tenant.findMany({ where: { status: 'active' } }));
      const match = tenants.find((t) => (t.settings as Record<string, unknown>)?.slackTeamId === teamId);
      if (match) return match.id;
    }
    // 本番では team_id 未一致時に無関係テナントへ落とさない (DEVフォールバックは開発のみ)
    if (process.env.NODE_ENV === 'production') return null;
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
    const a = Buffer.from(hmac);
    const b = Buffer.from(signature);
    // timingSafeEqual は長さ不一致で RangeError を投げる。短い署名を送られるだけで
    // 500 になるため、先に長さを比較する (不一致は署名不一致として扱う)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Slack署名が一致しません。', 'Signing Secret の設定を確認してください。');
    }
  }

  private msg(text: string): { response_type: string; text: string } {
    return { response_type: 'ephemeral', text };
  }
}
