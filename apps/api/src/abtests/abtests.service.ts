import { HttpStatus, Injectable } from '@nestjs/common';
import { twoProportionPValue } from '@adgrid/shared';
import type { AbTestDto, CreateAbTestInput } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';

type AbRow = {
  id: string;
  clientId: string;
  name: string;
  hypothesis: string;
  metric: string;
  status: string;
  aLabel: string;
  aImpr: number;
  aClicks: number;
  aConv: number;
  bLabel: string;
  bImpr: number;
  bClicks: number;
  bConv: number;
  createdAt: Date;
  client: { name: string };
};

// CVR/CTR判定に十分とみなす最小サンプル (各アームのCV or Click)
const MIN_SAMPLE = 30;

@Injectable()
export class AbTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  private evaluate(row: AbRow): AbTestDto {
    const useCvr = row.metric !== 'ctr';
    // cvr: 分母=クリック・分子=CV / ctr: 分母=インプ・分子=クリック
    const aDen = useCvr ? row.aClicks : row.aImpr;
    const bDen = useCvr ? row.bClicks : row.bImpr;
    const aNum = useCvr ? row.aConv : row.aClicks;
    const bNum = useCvr ? row.bConv : row.bClicks;
    const aRate = aDen > 0 ? +((aNum / aDen) * 100).toFixed(2) : null;
    const bRate = bDen > 0 ? +((bNum / bDen) * 100).toFixed(2) : null;

    const pValue = twoProportionPValue(aNum, aDen, bNum, bDen);
    const enoughData = aNum >= MIN_SAMPLE && bNum >= MIN_SAMPLE;
    const significant = pValue !== null && pValue < 0.05 && enoughData;
    const lift = aRate && bRate && aRate > 0 ? +(((bRate - aRate) / aRate) * 100).toFixed(1) : null;

    let winner: 'a' | 'b' | 'none' = 'none';
    if (significant && aRate !== null && bRate !== null) winner = bRate > aRate ? 'b' : 'a';

    const metricLabel = useCvr ? 'CVR' : 'CTR';
    let summary: string;
    if (!enoughData) {
      summary = `サンプルが不足しています (各アーム${MIN_SAMPLE}件以上の${useCvr ? 'CV' : 'クリック'}が必要)。配信を継続してください。`;
    } else if (!significant) {
      summary = `統計的な有意差はまだありません (p=${pValue!.toFixed(3)})。差が偶然の範囲のため、継続して様子を見てください。`;
    } else {
      const w = winner === 'b' ? row.bLabel : row.aLabel;
      summary = `「${w}」が有意に優れています (${metricLabel} ${winner === 'b' ? bRate : aRate}% vs ${winner === 'b' ? aRate : bRate}%、p=${pValue!.toFixed(3)})。こちらを採用できます。`;
    }

    return {
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      name: row.name,
      hypothesis: row.hypothesis,
      metric: useCvr ? 'cvr' : 'ctr',
      status: row.status as 'running' | 'concluded',
      a: { label: row.aLabel, impressions: row.aImpr, clicks: row.aClicks, conversions: row.aConv, rate: aRate },
      b: { label: row.bLabel, impressions: row.bImpr, clicks: row.bClicks, conversions: row.bConv, rate: bRate },
      result: { winner, lift, pValue: pValue === null ? null : +pValue.toFixed(4), significant, enoughData, summary },
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(tenantId: string, clientId?: string): Promise<AbTestDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.abTest.findMany({
        where: clientId ? { clientId } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { client: true },
      }),
    );
    return rows.map((r) => this.evaluate(r as AbRow));
  }

  private validateArm(arm: { impressions: number; clicks: number; conversions: number }, name: string): void {
    const { impressions, clicks, conversions } = arm;
    if ([impressions, clicks, conversions].some((v) => !Number.isFinite(v) || v < 0)) {
      throw new AppError(HttpStatus.BAD_REQUEST, `${name}の数値が正しくありません。`, '0以上の整数で入力してください。');
    }
    if (clicks > impressions || conversions > clicks) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${name}の数値に矛盾があります。`,
        'クリックは表示回数以下、CVはクリック以下にしてください。',
      );
    }
  }

  async create(tenantId: string, input: CreateAbTestInput): Promise<AbTestDto> {
    if (!input?.clientId || !input?.name?.trim() || !input?.a || !input?.b) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'テスト名・クライアント・両アームは必須です。', '入力内容を確認してください。');
    }
    this.validateArm(input.a, 'アームA');
    this.validateArm(input.b, 'アームB');
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      return tx.abTest.create({
        data: {
          tenantId,
          clientId: input.clientId,
          name: input.name.trim(),
          hypothesis: input.hypothesis ?? '',
          metric: input.metric === 'ctr' ? 'ctr' : 'cvr',
          aLabel: input.a.label?.trim() || 'A案',
          aImpr: Math.round(input.a.impressions),
          aClicks: Math.round(input.a.clicks),
          aConv: Math.round(input.a.conversions),
          bLabel: input.b.label?.trim() || 'B案',
          bImpr: Math.round(input.b.impressions),
          bClicks: Math.round(input.b.clicks),
          bConv: Math.round(input.b.conversions),
        },
        include: { client: true },
      });
    });
    await this.trail.record({ tenantId, action: 'abtest_create', resource: row.id });
    return this.evaluate(row as AbRow);
  }

  async conclude(tenantId: string, id: string): Promise<AbTestDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.abTest.findUnique({ where: { id }, include: { client: true } });
      if (!existing) throw new AppError(HttpStatus.NOT_FOUND, 'テストが見つかりません。', '一覧を再読込してください。');
      const evaluated = this.evaluate(existing as AbRow);
      return tx.abTest.update({
        where: { id },
        data: { status: 'concluded', winner: evaluated.result.winner },
        include: { client: true },
      });
    });
    await this.trail.record({ tenantId, action: 'abtest_conclude', resource: id });
    return this.evaluate(row as AbRow);
  }
}
