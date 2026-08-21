import { Injectable, Logger } from '@nestjs/common';
import type {
  AlertChannel,
  AlertEventDto,
  AlertMetric,
  AlertRuleDto,
  AlertRunResultDto,
  Platform,
} from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { MetricsService, daysAgo } from '../metrics/metrics.service';
import { TrailService } from '../common/trail.service';

/** デフォルトルール (閾値はUIで変更可能) */
const DEFAULT_RULES: Array<{ metric: AlertMetric; threshold: number }> = [
  { metric: 'budget_pace', threshold: 120 }, // 月予算消化ペースが経過率比 120% 超
  { metric: 'cpa_spike', threshold: 30 }, // CPA前週比 +30% 超
  { metric: 'cv_zero', threshold: 200 }, // クリックN件以上でCV0 (計測欠落疑い)
  { metric: 'spend_drop', threshold: 50 }, // 昨日の消化が直近7日平均比 -50% 超 (配信停止疑い)
];

/** 同一ルール×アカウントの再通知抑制 (ノイズ対策) */
const COOLDOWN_HOURS = 6;
/** /home からの遅延検知の最小間隔 */
const LAZY_DETECT_MINUTES = 15;

interface FiredAlert {
  metric: AlertMetric;
  ruleId: string;
  adAccountId: string;
  severity: 'bad' | 'warn';
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly lastDetection = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly trail: TrailService,
  ) {}

  /* ---------------- ルール管理 ---------------- */

  async getRules(tenantId: string): Promise<AlertRuleDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      let rules = await tx.alertRule.findMany({ orderBy: { metric: 'asc' } });
      if (rules.length === 0) {
        await tx.alertRule.createMany({
          data: DEFAULT_RULES.map((r) => ({
            tenantId,
            metric: r.metric,
            threshold: r.threshold,
            channels: ['inapp'],
          })),
        });
        rules = await tx.alertRule.findMany({ orderBy: { metric: 'asc' } });
      }
      return rules.map((r) => ({
        id: r.id,
        metric: r.metric as AlertMetric,
        threshold: r.threshold,
        enabled: r.enabled,
        channels: (r.channels as AlertChannel[]) ?? ['inapp'],
      }));
    });
  }

  async updateRule(
    tenantId: string,
    id: string,
    patch: { threshold?: number; enabled?: boolean; channels?: AlertChannel[] },
  ): Promise<AlertRuleDto[]> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.alertRule.update({
        where: { id },
        data: {
          ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.channels !== undefined ? { channels: patch.channels } : {}),
        },
      }),
    );
    return this.getRules(tenantId);
  }

  /* ---------------- 通知設定 (tenant.settings) ---------------- */

  async getSettings(tenantId: string): Promise<{ slackWebhookUrl: string }> {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    const s = (tenant?.settings ?? {}) as Record<string, unknown>;
    return { slackWebhookUrl: typeof s.slackWebhookUrl === 'string' ? s.slackWebhookUrl : '' };
  }

  async updateSettings(tenantId: string, slackWebhookUrl: string): Promise<{ slackWebhookUrl: string }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>), slackWebhookUrl };
      await tx.tenant.update({ where: { id: tenantId }, data: { settings } });
    });
    return { slackWebhookUrl };
  }

  /* ---------------- 検知 ---------------- */

  private async evaluate(tx: Tx, tenantId: string, rules: AlertRuleDto[]): Promise<FiredAlert[]> {
    const enabled = new Map(rules.filter((r) => r.enabled).map((r) => [r.metric, r]));
    if (enabled.size === 0) return [];
    const accounts = await tx.adAccount.findMany({ include: { client: true } });
    const fired: FiredAlert[] = [];

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsedRatio = now.getDate() / daysInMonth;
    const monthStart = daysAgo(0);
    monthStart.setUTCDate(1);

    for (const acc of accounts) {
      const [last7, prior7, mtd, yesterday] = await Promise.all([
        this.metrics.totals(tx, { adAccountId: acc.id }, daysAgo(6), daysAgo(0)),
        this.metrics.totals(tx, { adAccountId: acc.id }, daysAgo(13), daysAgo(7)),
        this.metrics.totals(tx, { adAccountId: acc.id }, monthStart, daysAgo(0)),
        this.metrics.totals(tx, { adAccountId: acc.id }, daysAgo(1), daysAgo(1)),
      ]);

      const budgetRule = enabled.get('budget_pace');
      const budget = acc.monthlyBudget ? Number(acc.monthlyBudget) : null;
      if (budgetRule && budget && budget > 0) {
        const paceRatio = (mtd.cost / budget / elapsedRatio) * 100;
        if (paceRatio > budgetRule.threshold) {
          fired.push({
            metric: 'budget_pace',
            ruleId: budgetRule.id,
            adAccountId: acc.id,
            severity: 'bad',
            title: `予算超過ペース — 月予算の${Math.round((mtd.cost / budget) * 100)}%を消化`,
            body: `${acc.name}: 消化ペースが月の経過率に対し${Math.round(paceRatio)}%です。日予算の見直しを推奨します。`,
            payload: { paceRatio: Math.round(paceRatio), mtdCost: Math.round(mtd.cost), budget },
          });
        }
      }

      const cpaRule = enabled.get('cpa_spike');
      const curCpa = last7.conversions > 0 ? last7.cost / last7.conversions : null;
      const prevCpa = prior7.conversions > 0 ? prior7.cost / prior7.conversions : null;
      if (cpaRule && curCpa && prevCpa) {
        const delta = ((curCpa - prevCpa) / prevCpa) * 100;
        if (delta > cpaRule.threshold) {
          fired.push({
            metric: 'cpa_spike',
            ruleId: cpaRule.id,
            adAccountId: acc.id,
            severity: 'warn',
            title: `CPA急変 — 直近7日 ¥${Math.round(curCpa).toLocaleString('ja-JP')} (前週比 +${Math.round(delta)}%)`,
            body: `${acc.name}: AI診断で要因を特定できます。`,
            payload: { curCpa: Math.round(curCpa), prevCpa: Math.round(prevCpa), delta: Math.round(delta) },
          });
        }
      }

      const cvRule = enabled.get('cv_zero');
      if (cvRule && last7.clicks >= cvRule.threshold && last7.conversions === 0) {
        fired.push({
          metric: 'cv_zero',
          ruleId: cvRule.id,
          adAccountId: acc.id,
          severity: 'bad',
          title: `CV計測ゼロ — 直近7日でクリック${last7.clicks.toLocaleString('ja-JP')}件に対しCV 0件`,
          body: `${acc.name}: コンバージョンタグの計測欠落が疑われます。`,
          payload: { clicks: last7.clicks },
        });
      }

      const dropRule = enabled.get('spend_drop');
      const avg7 = last7.cost / 7;
      if (dropRule && avg7 > 3000) {
        const dropPct = ((avg7 - yesterday.cost) / avg7) * 100;
        if (dropPct > dropRule.threshold) {
          fired.push({
            metric: 'spend_drop',
            ruleId: dropRule.id,
            adAccountId: acc.id,
            severity: 'warn',
            title: `消化急減 — 昨日の消化が7日平均比 -${Math.round(dropPct)}%`,
            body: `${acc.name}: 配信停止・審査落ち・予算切れの可能性があります。媒体の配信状況を確認してください。`,
            payload: { yesterdayCost: Math.round(yesterday.cost), avg7: Math.round(avg7) },
          });
        }
      }
    }
    return fired;
  }

  /** 検知を実行し、クールダウンを通過したものだけをイベント化・通知する */
  async runDetection(tenantId: string): Promise<AlertRunResultDto> {
    const rules = await this.getRules(tenantId);
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const fired = await this.evaluate(tx, tenantId, rules);
      let firedCount = 0;
      let suppressed = 0;
      const created: Array<{ id: string; alert: FiredAlert }> = [];
      const cooldownSince = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000);
      for (const alert of fired) {
        const recent = await tx.alertEvent.findFirst({
          where: {
            ruleId: alert.ruleId,
            adAccountId: alert.adAccountId,
            firedAt: { gte: cooldownSince },
          },
        });
        if (recent) {
          suppressed++;
          continue;
        }
        const row = await tx.alertEvent.create({
          data: {
            tenantId,
            ruleId: alert.ruleId,
            adAccountId: alert.adAccountId,
            severity: alert.severity,
            title: alert.title,
            body: alert.body,
            payload: alert.payload as object,
          },
        });
        created.push({ id: row.id, alert });
        firedCount++;
      }
      return { firedCount, suppressed, created };
    });

    // Slack通知 (トランザクション外。失敗しても検知結果は保持)
    let notified = 0;
    const slackRules = new Set(
      rules.filter((r) => r.enabled && r.channels.includes('slack')).map((r) => r.id),
    );
    if (result.created.some((c) => slackRules.has(c.alert.ruleId))) {
      const { slackWebhookUrl } = await this.getSettings(tenantId);
      if (slackWebhookUrl) {
        for (const c of result.created) {
          if (!slackRules.has(c.alert.ruleId)) continue;
          const ok = await this.postSlack(slackWebhookUrl, c.alert);
          if (ok) {
            notified++;
            await this.prisma.withTenant(tenantId, (tx) =>
              tx.alertEvent.update({ where: { id: c.id }, data: { notifiedAt: new Date() } }),
            );
          }
        }
      }
    }

    this.lastDetection.set(tenantId, Date.now());
    if (result.firedCount > 0) {
      await this.trail.record({
        tenantId,
        action: 'alert_detection',
        detail: { fired: result.firedCount, suppressed: result.suppressed, notified },
      });
    }
    return { fired: result.firedCount, suppressed: result.suppressed, notified };
  }

  /** /home 用: 最終検知から一定時間経過していれば検知してから返す */
  async ensureFreshDetection(tenantId: string): Promise<void> {
    const last = this.lastDetection.get(tenantId) ?? 0;
    if (Date.now() - last < LAZY_DETECT_MINUTES * 60 * 1000) return;
    try {
      await this.runDetection(tenantId);
    } catch (e) {
      this.logger.warn(`lazy detection failed tenant=${tenantId}: ${String(e)}`);
    }
  }

  private async postSlack(webhookUrl: string, alert: FiredAlert): Promise<boolean> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `${alert.severity === 'bad' ? '🔴' : '🟡'} ADGRIDアラート: ${alert.title}\n${alert.body}`,
        }),
      });
      return res.ok;
    } catch (e) {
      this.logger.warn(`slack notify failed: ${String(e)}`);
      return false;
    }
  }

  /** Slack接続テスト (設定画面の「テスト送信」) */
  async testSlack(tenantId: string): Promise<boolean> {
    const { slackWebhookUrl } = await this.getSettings(tenantId);
    if (!slackWebhookUrl) return false;
    return this.postSlack(slackWebhookUrl, {
      metric: 'cpa_spike',
      ruleId: '',
      adAccountId: '',
      severity: 'warn',
      title: 'テスト通知',
      body: 'ADGRIDからの通知はこのように届きます。',
      payload: {},
    });
  }

  /* ---------------- 履歴 ---------------- */

  async listEvents(tenantId: string, limit = 50): Promise<AlertEventDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.alertEvent.findMany({
        orderBy: { firedAt: 'desc' },
        take: Math.min(limit, 200),
        include: { rule: true },
      });
      const accounts = await tx.adAccount.findMany({ include: { client: true } });
      const accMap = new Map(accounts.map((a) => [a.id, a]));
      return rows.map((e) => {
        const acc = accMap.get(e.adAccountId);
        return {
          id: e.id,
          metric: e.rule.metric as AlertMetric,
          severity: e.severity as 'bad' | 'warn',
          title: e.title,
          body: e.body,
          clientName: acc?.client.name ?? '',
          accountName: acc?.name ?? '',
          platform: (acc?.platform ?? 'google_ads') as Platform,
          adAccountId: e.adAccountId,
          firedAt: e.firedAt.toISOString(),
          notified: e.notifiedAt !== null,
          acked: e.ackedAt !== null,
        };
      });
    });
  }

  async ackEvent(tenantId: string, id: string, userId: string | null): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.alertEvent.update({ where: { id }, data: { ackedAt: new Date(), ackedBy: userId } }),
    );
  }

  /** 未確認イベント (ホーム司令室用) */
  async unackedEvents(tenantId: string): Promise<AlertEventDto[]> {
    const events = await this.listEvents(tenantId, 100);
    return events.filter((e) => !e.acked);
  }
}
