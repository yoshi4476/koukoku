import { Injectable } from '@nestjs/common';
import type { DailyPointDto, KpiSummaryDto, PlatformBreakdownDto, Platform } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface FactFilter {
  clientId?: string;
  adAccountId?: string;
  platform?: string;
}

export interface Totals {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

/**
 * 日付は常に「ローカルの暦日をUTC深夜に固定」して扱う。
 * Prisma の @db.Date はUTC日付に切り捨てるため、ローカル深夜のDateを
 * 渡すとJSTでは1日ずれる。生成・比較・表示のすべてをこの規約に統一する。
 */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function daysAgo(n: number): Date {
  const d = startOfDay(new Date());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return +(((cur - prev) / prev) * 100).toFixed(1);
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(filter: FactFilter, since: Date, until: Date) {
    return {
      date: { gte: since, lte: until },
      ...(filter.adAccountId ? { adAccountId: filter.adAccountId } : {}),
      ...(filter.platform ? { platform: filter.platform } : {}),
      ...(filter.clientId ? { adAccount: { clientId: filter.clientId } } : {}),
    };
  }

  async totals(tx: Tx, filter: FactFilter, since: Date, until: Date): Promise<Totals> {
    const agg = await tx.factAdPerformance.aggregate({
      where: this.where(filter, since, until),
      _sum: {
        cost: true,
        impressions: true,
        clicks: true,
        conversions: true,
        conversionValue: true,
      },
    });
    return {
      cost: Number(agg._sum.cost ?? 0),
      impressions: Number(agg._sum.impressions ?? 0),
      clicks: Number(agg._sum.clicks ?? 0),
      conversions: Number(agg._sum.conversions ?? 0),
      conversionValue: Number(agg._sum.conversionValue ?? 0),
    };
  }

  kpiFromTotals(cur: Totals, prev: Totals): KpiSummaryDto {
    const cpa = cur.conversions > 0 ? Math.round(cur.cost / cur.conversions) : null;
    const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
    const roas = cur.cost > 0 ? +((cur.conversionValue / cur.cost) * 100).toFixed(0) : null;
    const prevRoas = prev.cost > 0 ? (prev.conversionValue / prev.cost) * 100 : null;
    return {
      cost: cur.cost,
      conversions: +cur.conversions.toFixed(1),
      cpa,
      roas,
      clicks: cur.clicks,
      impressions: cur.impressions,
      deltas: {
        cost: pctDelta(cur.cost, prev.cost),
        conversions: pctDelta(cur.conversions, prev.conversions),
        cpa: cpa !== null && prevCpa ? pctDelta(cpa, prevCpa) : null,
        roas: roas !== null && prevRoas ? pctDelta(roas, prevRoas) : null,
      },
    };
  }

  async dailyTrend(tx: Tx, filter: FactFilter, since: Date, until: Date): Promise<DailyPointDto[]> {
    const rows = await tx.factAdPerformance.groupBy({
      by: ['date'],
      where: this.where(filter, since, until),
      _sum: { cost: true, conversions: true },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: isoDate(r.date),
      cost: Number(r._sum.cost ?? 0),
      conversions: +Number(r._sum.conversions ?? 0).toFixed(1),
    }));
  }

  async byPlatform(
    tx: Tx,
    filter: FactFilter,
    since: Date,
    until: Date,
    prevSince: Date,
    prevUntil: Date,
  ): Promise<PlatformBreakdownDto[]> {
    const group = (s: Date, u: Date) =>
      tx.factAdPerformance.groupBy({
        by: ['platform'],
        where: this.where(filter, s, u),
        _sum: {
          cost: true,
          impressions: true,
          clicks: true,
          conversions: true,
          conversionValue: true,
        },
      });
    const [cur, prev] = await Promise.all([group(since, until), group(prevSince, prevUntil)]);
    const prevMap = new Map(prev.map((p) => [p.platform, p]));
    return cur
      .map((r) => {
        const cost = Number(r._sum.cost ?? 0);
        const clicks = Number(r._sum.clicks ?? 0);
        const impressions = Number(r._sum.impressions ?? 0);
        const conversions = Number(r._sum.conversions ?? 0);
        const conversionValue = Number(r._sum.conversionValue ?? 0);
        const p = prevMap.get(r.platform);
        const prevCost = Number(p?._sum.cost ?? 0);
        const prevConv = Number(p?._sum.conversions ?? 0);
        const cpa = conversions > 0 ? Math.round(cost / conversions) : null;
        const prevCpa = prevConv > 0 ? prevCost / prevConv : null;
        return {
          platform: r.platform as Platform,
          cost,
          impressions,
          clicks,
          conversions: +conversions.toFixed(1),
          conversionValue,
          ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null,
          cvr: clicks > 0 ? +((conversions / clicks) * 100).toFixed(2) : null,
          cpa,
          roas: cost > 0 ? +((conversionValue / cost) * 100).toFixed(0) : null,
          cpaDelta: cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
        };
      })
      .sort((a, b) => b.cost - a.cost);
  }
}
