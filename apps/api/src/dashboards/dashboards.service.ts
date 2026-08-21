import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  DashboardDef,
  DashboardListDto,
  WidgetDataDto,
  WidgetDef,
  WidgetMetric,
  Platform,
} from '@adgrid/shared';
import { WIDGET_METRIC_UNIT, PLATFORM_META } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, Totals, daysAgo, isoDate } from '../metrics/metrics.service';

export function metricValue(m: WidgetMetric, t: Totals): number | null {
  switch (m) {
    case 'cost': return t.cost;
    case 'conversions': return +t.conversions.toFixed(1);
    case 'clicks': return t.clicks;
    case 'impressions': return t.impressions;
    case 'cpa': return t.conversions > 0 ? Math.round(t.cost / t.conversions) : null;
    case 'roas': return t.cost > 0 ? +((t.conversionValue / t.cost) * 100).toFixed(0) : null;
    case 'ctr': return t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null;
    case 'cvr': return t.clicks > 0 ? +((t.conversions / t.clicks) * 100).toFixed(2) : null;
  }
}

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async list(tenantId: string): Promise<DashboardListDto> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.dashboard.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
    );
    return {
      dashboards: rows.map((d) => ({
        id: d.id,
        name: d.name,
        isDefault: d.isDefault,
        widgetCount: Array.isArray(d.layout) ? (d.layout as unknown[]).length : 0,
      })),
    };
  }

  private toDef(d: { id: string; name: string; isDefault: boolean; layout: unknown; updatedAt: Date }): DashboardDef {
    return {
      id: d.id,
      name: d.name,
      isDefault: d.isDefault,
      layout: (Array.isArray(d.layout) ? d.layout : []) as WidgetDef[],
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  async get(tenantId: string, id: string): Promise<DashboardDef> {
    const d = await this.prisma.withTenant(tenantId, (tx) => tx.dashboard.findUnique({ where: { id } }));
    if (!d) throw new AppError(HttpStatus.NOT_FOUND, 'ダッシュボードが見つかりません。', '一覧から選び直してください。');
    return this.toDef(d);
  }

  async create(tenantId: string, userId: string | null, name: string): Promise<DashboardDef> {
    if (!name?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'ダッシュボード名が未入力です。', '名前を入力してください。');
    }
    const d = await this.prisma.withTenant(tenantId, (tx) =>
      tx.dashboard.create({ data: { tenantId, name: name.trim(), layout: [], createdBy: userId } }),
    );
    return this.toDef(d);
  }

  async saveLayout(tenantId: string, id: string, name: string, layout: WidgetDef[]): Promise<DashboardDef> {
    if (!Array.isArray(layout)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'レイアウトの形式が不正です。', 'ページを再読込して再試行してください。');
    }
    const d = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.dashboard.findUnique({ where: { id } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'ダッシュボードが見つかりません。', '一覧を再読込してください。');
      return tx.dashboard.update({
        where: { id },
        data: { ...(name?.trim() ? { name: name.trim() } : {}), layout: layout as object[] },
      });
    });
    return this.toDef(d);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.dashboard.findUnique({ where: { id } });
      if (!d) throw new AppError(HttpStatus.NOT_FOUND, 'ダッシュボードが見つかりません。', '一覧を再読込してください。');
      if (d.isDefault) {
        throw new AppError(HttpStatus.BAD_REQUEST, '既定のダッシュボードは削除できません。', '別のダッシュボードを既定に設定してから削除してください。');
      }
      await tx.dashboard.delete({ where: { id } });
    });
  }

  /* ---------------- ウィジェットデータ集約 ---------------- */

  async widgetData(tenantId: string, id: string): Promise<WidgetDataDto[]> {
    const def = await this.get(tenantId, id);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const out: WidgetDataDto[] = [];
      for (const w of def.layout) {
        out.push(await this.computeWidget(tx, w));
      }
      return out;
    });
  }

  private async computeWidget(tx: Tx, w: WidgetDef): Promise<WidgetDataDto> {
    const days = Math.min(Math.max(w.days || 7, 1), 90);
    const since = daysAgo(days - 1);
    const until = daysAgo(0);
    const unit = WIDGET_METRIC_UNIT[w.metric];
    const filter = w.clientId ? { clientId: w.clientId } : {};

    if (w.type === 'stat' || w.dimension === 'none') {
      const [cur, prev] = await Promise.all([
        this.metrics.totals(tx, filter, since, until),
        this.metrics.totals(tx, filter, daysAgo(days * 2 - 1), daysAgo(days)),
      ]);
      const value = metricValue(w.metric, cur) ?? 0;
      const prevVal = metricValue(w.metric, prev);
      const delta = prevVal && prevVal !== 0 ? +(((value - prevVal) / prevVal) * 100).toFixed(1) : null;
      return { widgetId: w.id, metric: w.metric, stat: { value, delta }, unit };
    }

    if (w.dimension === 'platform') {
      const rows = await tx.factAdPerformance.groupBy({
        by: ['platform'],
        where: { date: { gte: since, lte: until }, ...(w.clientId ? { adAccount: { clientId: w.clientId } } : {}) },
        _sum: { cost: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
      });
      const series = rows
        .map((r) => ({
          label: PLATFORM_META[r.platform as Platform]?.label ?? r.platform,
          value: metricValue(w.metric, sumOf(r._sum)) ?? 0,
        }))
        .sort((a, b) => b.value - a.value);
      return { widgetId: w.id, metric: w.metric, series, unit };
    }

    if (w.dimension === 'date') {
      const rows = await tx.factAdPerformance.groupBy({
        by: ['date'],
        where: { date: { gte: since, lte: until }, ...(w.clientId ? { adAccount: { clientId: w.clientId } } : {}) },
        _sum: { cost: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
        orderBy: { date: 'asc' },
      });
      const series = rows.map((r) => ({
        label: isoDate(r.date),
        value: metricValue(w.metric, sumOf(r._sum)) ?? 0,
      }));
      return { widgetId: w.id, metric: w.metric, series, unit };
    }

    // dimension === 'client'
    const clients = await tx.client.findMany({ where: { status: 'active' } });
    const series: Array<{ label: string; value: number }> = [];
    for (const c of clients) {
      const t = await this.metrics.totals(tx, { clientId: c.id }, since, until);
      series.push({ label: c.name, value: metricValue(w.metric, t) ?? 0 });
    }
    series.sort((a, b) => b.value - a.value);
    return { widgetId: w.id, metric: w.metric, series, unit };
  }
}

function sumOf(s: {
  cost: unknown; impressions: unknown; clicks: unknown; conversions: unknown; conversionValue: unknown;
}): Totals {
  return {
    cost: Number(s.cost ?? 0),
    impressions: Number(s.impressions ?? 0),
    clicks: Number(s.clicks ?? 0),
    conversions: Number(s.conversions ?? 0),
    conversionValue: Number(s.conversionValue ?? 0),
  };
}
