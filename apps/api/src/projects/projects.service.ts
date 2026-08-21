import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuditResult,
  ConnectionStatus,
  CreateProjectInput,
  Platform,
  ProjectAccountDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectGoal,
  ProjectStatus,
  UpdateProjectInput,
} from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';
import { AlertsService } from '../alerts/alerts.service';

const GOALS: ProjectGoal[] = ['conversion', 'awareness', 'traffic', 'store'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
  ) {}

  private cpa(cost: number, conv: number): number | null {
    return conv > 0 ? Math.round(cost / conv) : null;
  }

  /** アカウント群の最新診断から未対応指摘数を数える */
  private async openFindingsFor(tx: Tx, accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0;
    const audits = await tx.audit.findMany({
      where: { adAccountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      take: accountIds.length * 3,
    });
    const seen = new Set<string>();
    let open = 0;
    for (const a of audits) {
      if (seen.has(a.adAccountId)) continue;
      seen.add(a.adAccountId);
      const statuses = (a.findingStatuses ?? {}) as Record<string, string>;
      for (const f of (a.result as unknown as AuditResult).findings ?? []) {
        if ((statuses[String(f.priority_rank)] ?? 'open') === 'open') open++;
      }
    }
    return open;
  }

  async list(tenantId: string): Promise<ProjectDto[]> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const projects = await tx.project.findMany({
        include: { client: true, adAccounts: { select: { id: true, platform: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const out: ProjectDto[] = [];
      for (const p of projects) {
        const accountIds = p.adAccounts.map((a) => a.id);
        const [cur, prev, lastReport, openFindings] = await Promise.all([
          this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(6), daysAgo(0)),
          this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(7)),
          tx.report.findFirst({ where: { clientId: p.clientId }, orderBy: { createdAt: 'desc' } }),
          this.openFindingsFor(tx, accountIds),
        ]);
        const cpa = this.cpa(cur.cost, cur.conversions);
        const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
        const acctSet = new Set(accountIds);
        out.push({
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: p.client.name,
          industryCode: p.client.industryCode,
          goal: p.goal as ProjectGoal,
          status: p.status as ProjectStatus,
          note: p.note,
          accountCount: accountIds.length,
          platforms: [...new Set(p.adAccounts.map((a) => a.platform))] as Platform[],
          cost7d: cur.cost,
          conversions7d: +cur.conversions.toFixed(1),
          cpa7d: cpa,
          cpaDelta: cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
          alertCount: events.filter((e) => acctSet.has(e.adAccountId)).length,
          openFindings,
          lastReportAt: lastReport?.createdAt.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        });
      }
      return out;
    });
  }

  async detail(tenantId: string, id: string): Promise<ProjectDetailDto> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.project.findUnique({
        where: { id },
        include: { client: true, adAccounts: { orderBy: { name: 'asc' } } },
      });
      if (!p) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const accountIds = p.adAccounts.map((a) => a.id);
      const connections = await tx.mediaConnection.findMany({});
      const connMap = new Map(connections.map((c) => [c.platform, c]));

      const [cur, prev, trend, lastReport, openFindings] = await Promise.all([
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(6), daysAgo(0)),
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(7)),
        this.metrics.dailyTrend(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(0)),
        tx.report.findFirst({ where: { clientId: p.clientId }, orderBy: { createdAt: 'desc' } }),
        this.openFindingsFor(tx, accountIds),
      ]);

      const accounts: ProjectAccountDto[] = [];
      for (const a of p.adAccounts) {
        const t = await this.metrics.totals(tx, { adAccountId: a.id }, daysAgo(6), daysAgo(0));
        const conn = connMap.get(a.platform);
        accounts.push({
          adAccountId: a.id,
          name: a.name,
          platform: a.platform as Platform,
          connectionStatus: (conn?.status ?? 'not_connected') as ConnectionStatus,
          monthlyBudget: a.monthlyBudget ? Number(a.monthlyBudget) : null,
          cost7d: t.cost,
          conversions7d: +t.conversions.toFixed(1),
          cpa7d: this.cpa(t.cost, t.conversions),
        });
      }
      const acctSet = new Set(accountIds);

      return {
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.client.name,
        industryCode: p.client.industryCode,
        goal: p.goal as ProjectGoal,
        status: p.status as ProjectStatus,
        note: p.note,
        kpi: this.metrics.kpiFromTotals(cur, prev),
        trend,
        accounts,
        alerts: events.filter((e) => acctSet.has(e.adAccountId)),
        openFindings,
        lastReportAt: lastReport?.createdAt.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  async create(tenantId: string, input: CreateProjectInput): Promise<ProjectDto> {
    if (!input?.name?.trim() || !input?.clientId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'プロジェクト名またはクライアントが未指定です。',
        'プロジェクト名とクライアントを選択してください。',
      );
    }
    const goal: ProjectGoal = GOALS.includes(input.goal as ProjectGoal) ? (input.goal as ProjectGoal) : 'conversion';
    await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      const project = await tx.project.create({
        data: { tenantId, clientId: input.clientId, name: input.name.trim(), goal, note: input.note ?? '' },
      });
      if (input.accountIds?.length) {
        await tx.adAccount.updateMany({
          where: { id: { in: input.accountIds }, clientId: input.clientId },
          data: { projectId: project.id },
        });
      }
      return project;
    });
    const all = await this.list(tenantId);
    return all[0];
  }

  async update(tenantId: string, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const data: Record<string, unknown> = {};
      if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
      if (input.goal && GOALS.includes(input.goal)) data.goal = input.goal;
      if (input.status) data.status = input.status;
      if (typeof input.note === 'string') data.note = input.note;
      if (Object.keys(data).length) await tx.project.update({ where: { id }, data });

      if (input.accountIds) {
        // 既存の紐付けを解除し、指定アカウントを再割当 (同一クライアント内のみ)
        await tx.adAccount.updateMany({ where: { projectId: id }, data: { projectId: null } });
        if (input.accountIds.length) {
          await tx.adAccount.updateMany({
            where: { id: { in: input.accountIds }, clientId: project.clientId },
            data: { projectId: id },
          });
        }
      }
    });
    const all = await this.list(tenantId);
    const found = all.find((p) => p.id === id);
    if (!found) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '再読み込みしてください。');
    return found;
  }
}
