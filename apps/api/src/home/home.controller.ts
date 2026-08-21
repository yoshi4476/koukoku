import { Controller, Get } from '@nestjs/common';
import type { HomeDto, HomeTaskDto, Platform } from '@adgrid/shared';
import type { AuditResult } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { MetricsService, daysAgo, isoDate, startOfDay } from '../metrics/metrics.service';

@Controller('home')
export class HomeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  async home(@TenantId() tenantId: string): Promise<HomeDto> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const accounts = await tx.adAccount.findMany({ include: { client: true } });
      const tasks: HomeTaskDto[] = [];

      // --- アラート: 予算超過ペース / CPA急変 (ルールベース) ---
      const monthStart = startOfDay(new Date());
      monthStart.setUTCDate(1);
      const today = new Date();
      const elapsedRatio = today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

      for (const acc of accounts) {
        const mtd = await this.metrics.totals(tx, { adAccountId: acc.id }, monthStart, daysAgo(0));
        const budget = acc.monthlyBudget ? Number(acc.monthlyBudget) : null;
        if (budget && budget > 0) {
          const paceRatio = mtd.cost / budget / elapsedRatio;
          if (paceRatio > 1.2) {
            tasks.push({
              id: `alert-budget-${acc.id}`,
              kind: 'alert',
              severity: 'bad',
              title: `予算超過ペース — 月予算の${Math.round((mtd.cost / budget) * 100)}%を消化`,
              subtitle: `${acc.name}: このペースでは月内に予算到達の見込み。日予算の見直しを推奨`,
              clientName: acc.client.name,
              platform: acc.platform as Platform,
              href: `/dashboard?clientId=${acc.clientId}`,
            });
          }
        }
        const cur = await this.metrics.totals(tx, { adAccountId: acc.id }, daysAgo(6), daysAgo(0));
        const prev = await this.metrics.totals(tx, { adAccountId: acc.id }, daysAgo(13), daysAgo(7));
        const curCpa = cur.conversions > 0 ? cur.cost / cur.conversions : null;
        const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
        if (curCpa && prevCpa && curCpa > prevCpa * 1.3) {
          tasks.push({
            id: `alert-cpa-${acc.id}`,
            kind: 'alert',
            severity: 'warn',
            title: `CPA急変 — 直近7日 ¥${Math.round(curCpa).toLocaleString('ja-JP')} (前週比 +${Math.round(((curCpa - prevCpa) / prevCpa) * 100)}%)`,
            subtitle: `${acc.name}: 診断で要因を特定できます`,
            clientName: acc.client.name,
            platform: acc.platform as Platform,
            href: `/audit?accountId=${acc.id}`,
          });
        }
        if (cur.clicks >= 200 && cur.conversions === 0) {
          tasks.push({
            id: `alert-meas-${acc.id}`,
            kind: 'alert',
            severity: 'bad',
            title: `CV計測ゼロ — 直近7日でクリック${cur.clicks.toLocaleString('ja-JP')}件に対しCV 0件`,
            subtitle: `${acc.name}: コンバージョンタグの計測欠落が疑われます`,
            clientName: acc.client.name,
            platform: acc.platform as Platform,
            href: `/audit?accountId=${acc.id}`,
          });
        }
      }

      // --- AI提案: 各アカウント最新診断の未対応上位指摘 ---
      let adoptedCount = 0;
      const audits = await tx.audit.findMany({
        orderBy: { createdAt: 'desc' },
        include: { adAccount: { include: { client: true } } },
        take: 20,
      });
      const seenAccounts = new Set<string>();
      for (const audit of audits) {
        if (seenAccounts.has(audit.adAccountId)) continue;
        seenAccounts.add(audit.adAccountId);
        const result = audit.result as unknown as AuditResult;
        const statuses = (audit.findingStatuses ?? {}) as Record<string, string>;
        for (const f of result.findings ?? []) {
          const status = statuses[String(f.priority_rank)] ?? 'open';
          if (status === 'adopted') adoptedCount++;
          if (status !== 'open') continue;
          if (tasks.filter((t) => t.kind === 'ai_proposal').length >= 3) break;
          tasks.push({
            id: `prop-${audit.id}-${f.priority_rank}`,
            kind: 'ai_proposal',
            severity: 'ai',
            title: f.title,
            subtitle: `期待効果: ${f.expected_impact} · 確信度 ${f.confidence === 'high' ? '高' : f.confidence === 'mid' ? '中' : '低'}`,
            clientName: audit.adAccount.client.name,
            platform: audit.adAccount.platform as Platform,
            href: `/audit?accountId=${audit.adAccountId}`,
          });
        }
      }

      // --- レポート予定: 直近7日にレポートがないクライアント ---
      const clients = await tx.client.findMany({ where: { status: 'active' } });
      for (const client of clients) {
        const recent = await tx.report.findFirst({
          where: { clientId: client.id, createdAt: { gte: daysAgo(6) } },
        });
        if (!recent && tasks.filter((t) => t.kind === 'report').length < 2) {
          tasks.push({
            id: `report-${client.id}`,
            kind: 'report',
            severity: 'neutral',
            title: '週次レポートを生成できます',
            subtitle: `${client.name}: 直近7日分の実績が揃っています`,
            clientName: client.name,
            platform: null,
            href: `/report?clientId=${client.id}`,
          });
        }
      }

      const order: Record<string, number> = { alert: 0, ai_proposal: 1, approval: 2, report: 3 };
      tasks.sort((a, b) => order[a.kind] - order[b.kind]);

      return {
        date: isoDate(daysAgo(0)),
        doneCount: adoptedCount,
        totalCount: adoptedCount + tasks.length,
        tasks,
      };
    });
  }
}
