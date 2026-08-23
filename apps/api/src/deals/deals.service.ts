import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateDealInput, DealDto, DealStage, DealSummaryDto, UpdateDealInput } from '@adgrid/shared';
import { DEAL_STAGES, computeDealSummary } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';

type Row = {
  id: string; clientId: string; projectId: string | null; name: string; stage: string;
  value: number; grossMarginPct: number; source: string; note: string; createdAt: Date; closedAt: Date | null;
};

/** 成約(商談)パイプライン (F-47) */
@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  private toDto(r: Row): DealDto {
    return {
      id: r.id, clientId: r.clientId, projectId: r.projectId, name: r.name, stage: r.stage as DealStage,
      value: r.value, grossMarginPct: r.grossMarginPct, source: r.source, note: r.note,
      createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null,
    };
  }

  async list(tenantId: string, clientId?: string): Promise<DealDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.deal.findMany({ where: clientId ? { clientId } : {}, orderBy: { createdAt: 'desc' } }),
    );
    return (rows as Row[]).map((r) => this.toDto(r));
  }

  async create(tenantId: string, input: CreateDealInput): Promise<DealDto> {
    if (!input?.name?.trim() || !input?.clientId) {
      throw new AppError(HttpStatus.BAD_REQUEST, '案件名またはクライアントが未指定です。', '案件名とクライアントを入力してください。');
    }
    const stage: DealStage = DEAL_STAGES.includes(input.stage as DealStage) ? (input.stage as DealStage) : 'lead';
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      return tx.deal.create({
        data: {
          tenantId, clientId: input.clientId, projectId: input.projectId ?? null, name: input.name.trim(), stage,
          value: Math.max(0, Math.round(input.value ?? 0)), grossMarginPct: Math.min(100, Math.max(0, Math.round(input.grossMarginPct ?? 30))),
          source: input.source ?? '', note: input.note ?? '',
          closedAt: stage === 'won' || stage === 'lost' ? new Date() : null,
        },
      });
    });
    return this.toDto(row as Row);
  }

  async update(tenantId: string, id: string, input: UpdateDealInput): Promise<DealDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.deal.findUnique({ where: { id } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, '案件が見つかりません。', '一覧から選び直してください。');
      const data: Record<string, unknown> = {};
      if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
      if (input.stage && DEAL_STAGES.includes(input.stage)) {
        data.stage = input.stage;
        data.closedAt = input.stage === 'won' || input.stage === 'lost' ? (existing.closedAt ?? new Date()) : null;
      }
      if (typeof input.value === 'number') data.value = Math.max(0, Math.round(input.value));
      if (typeof input.grossMarginPct === 'number') data.grossMarginPct = Math.min(100, Math.max(0, Math.round(input.grossMarginPct)));
      if (typeof input.source === 'string') data.source = input.source;
      if (typeof input.note === 'string') data.note = input.note;
      return tx.deal.update({ where: { id }, data });
    });
    return this.toDto(row as Row);
  }

  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.deal.findUnique({ where: { id } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, '案件が見つかりません。', '再読み込みしてください。');
      await tx.deal.delete({ where: { id } });
    });
    return { ok: true };
  }

  /** クライアントの成約サマリ (成約率・受注額・粗利ROAS)。広告費は直近30日 */
  async summary(tenantId: string, clientId: string): Promise<DealSummaryDto> {
    const [deals, cost] = await this.prisma.withTenant(tenantId, async (tx) => {
      const d = (await tx.deal.findMany({ where: { clientId } })) as Row[];
      const t = await this.metrics.totals(tx, { clientId }, daysAgo(29), daysAgo(0));
      return [d, t.cost] as const;
    });
    return computeDealSummary(deals.map((r) => this.toDto(r)), cost);
  }
}
