import { Controller, Get } from '@nestjs/common';
import type { HomeDto, HomeTaskDto, Platform } from '@adgrid/shared';
import type { AuditResult } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { daysAgo, isoDate } from '../metrics/metrics.service';
import { AlertsService } from '../alerts/alerts.service';

@Controller('home')
export class HomeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  @Get()
  async home(@TenantId() tenantId: string): Promise<HomeDto> {
    // アラートは検知エンジン (F-13) を単一情報源にする。最終検知が古ければここで更新
    await this.alerts.ensureFreshDetection(tenantId);
    const events = await this.alerts.unackedEvents(tenantId);

    const tasks: HomeTaskDto[] = events.map((e) => ({
      id: `alert-${e.id}`,
      kind: 'alert',
      severity: e.severity,
      title: e.title,
      subtitle: `${e.accountName}: ${e.body.replace(`${e.accountName}: `, '')}`,
      clientName: e.clientName,
      platform: e.platform,
      href:
        e.metric === 'cpa_spike' || e.metric === 'cv_zero'
          ? `/audit?accountId=${e.adAccountId}`
          : '/alerts',
    }));

    const extra = await this.prisma.withTenant(tenantId, async (tx) => {
      const out: HomeTaskDto[] = [];

      // AI提案: 各アカウント最新診断の未対応上位指摘
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
          if (out.filter((t) => t.kind === 'ai_proposal').length >= 3) break;
          out.push({
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

      // 承認待ち: pending の提案 (F-16)
      const pendings = await tx.proposal.findMany({
        where: { status: 'pending' },
        include: { adAccount: { include: { client: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      for (const p of pendings) {
        out.push({
          id: `approval-${p.id}`,
          kind: 'approval',
          severity: 'warn',
          title: `承認待ち: ${p.title}`,
          subtitle: `${p.adAccount.name} · ${p.simulation}`,
          clientName: p.adAccount.client.name,
          platform: p.adAccount.platform as Platform,
          href: '/approvals',
        });
      }

      // レポート予定: 直近7日にレポートがないクライアント
      const clients = await tx.client.findMany({ where: { status: 'active' } });
      for (const client of clients) {
        const recent = await tx.report.findFirst({
          where: { clientId: client.id, createdAt: { gte: daysAgo(6) } },
        });
        if (!recent && out.filter((t) => t.kind === 'report').length < 2) {
          out.push({
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
      return { out, adoptedCount };
    });

    const all = [...tasks, ...extra.out];
    const order: Record<string, number> = { alert: 0, ai_proposal: 1, approval: 2, report: 3 };
    all.sort((a, b) => order[a.kind] - order[b.kind]);

    return {
      date: isoDate(daysAgo(0)),
      doneCount: extra.adoptedCount,
      totalCount: extra.adoptedCount + all.length,
      tasks: all,
    };
  }
}
