import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateLiftTestInput, LiftMethod, LiftStatus, LiftTestDto, UpdateLiftTestInput } from '@adgrid/shared';
import { computeLift } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

const METHODS: LiftMethod[] = ['geo', 'audience', 'holdback'];
const STATUSES: LiftStatus[] = ['planning', 'running', 'done'];

type Row = {
  id: string; clientId: string | null; name: string; method: string; holdoutPct: number;
  startDate: string | null; endDate: string | null; status: string;
  exposedAudience: number | null; exposedConversions: number | null; exposedCost: number | null;
  controlAudience: number | null; controlConversions: number | null; note: string; createdAt: Date;
};

/** 増分効果テストの設計・記録 (F-42) */
@Injectable()
export class LiftService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(r: Row): LiftTestDto {
    const hasResult = r.exposedAudience != null && r.controlAudience != null;
    return {
      id: r.id, clientId: r.clientId, name: r.name, method: r.method as LiftMethod, holdoutPct: r.holdoutPct,
      startDate: r.startDate, endDate: r.endDate, status: r.status as LiftStatus,
      exposedAudience: r.exposedAudience, exposedConversions: r.exposedConversions, exposedCost: r.exposedCost,
      controlAudience: r.controlAudience, controlConversions: r.controlConversions, note: r.note,
      createdAt: r.createdAt.toISOString(),
      result: hasResult
        ? computeLift({
            exposedAudience: r.exposedAudience ?? 0, exposedConversions: r.exposedConversions ?? 0,
            exposedCost: r.exposedCost ?? 0, controlAudience: r.controlAudience ?? 0, controlConversions: r.controlConversions ?? 0,
          })
        : null,
    };
  }

  async list(tenantId: string): Promise<LiftTestDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) => tx.liftTest.findMany({ orderBy: { createdAt: 'desc' } }));
    return (rows as Row[]).map((r) => this.toDto(r));
  }

  async create(tenantId: string, input: CreateLiftTestInput): Promise<LiftTestDto> {
    if (!input?.name?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'テスト名が未入力です。', 'テストの名前を入力してください。');
    }
    const method: LiftMethod = METHODS.includes(input.method as LiftMethod) ? (input.method as LiftMethod) : 'holdback';
    const holdoutPct = Math.min(50, Math.max(1, Math.round(input.holdoutPct ?? 10)));
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.liftTest.create({
        data: {
          tenantId, clientId: input.clientId ?? null, name: input.name.trim(), method, holdoutPct,
          startDate: input.startDate ?? null, endDate: input.endDate ?? null,
        },
      }),
    );
    return this.toDto(row as Row);
  }

  async update(tenantId: string, id: string, input: UpdateLiftTestInput): Promise<LiftTestDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.liftTest.findUnique({ where: { id } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'テストが見つかりません。', '一覧から選び直してください。');
      const data: Record<string, unknown> = {};
      if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
      if (input.status && STATUSES.includes(input.status)) data.status = input.status;
      if ('startDate' in input) data.startDate = input.startDate ?? null;
      if ('endDate' in input) data.endDate = input.endDate ?? null;
      if ('exposedAudience' in input) data.exposedAudience = input.exposedAudience ?? null;
      if ('exposedConversions' in input) data.exposedConversions = input.exposedConversions ?? null;
      if ('exposedCost' in input) data.exposedCost = input.exposedCost ?? null;
      if ('controlAudience' in input) data.controlAudience = input.controlAudience ?? null;
      if ('controlConversions' in input) data.controlConversions = input.controlConversions ?? null;
      if (typeof input.note === 'string') data.note = input.note;
      return tx.liftTest.update({ where: { id }, data });
    });
    return this.toDto(row as Row);
  }

  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.liftTest.findUnique({ where: { id } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'テストが見つかりません。', '再読み込みしてください。');
      await tx.liftTest.delete({ where: { id } });
    });
    return { ok: true };
  }
}
