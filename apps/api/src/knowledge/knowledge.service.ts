import { HttpStatus, Injectable } from '@nestjs/common';
import { benchmarkFor } from '@adgrid/shared';
import type { KnowledgeAssetDto, KnowledgeSearchDto, PromoteAbTestInput } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';

type KnowRow = {
  id: string;
  tenantId: string | null;
  industryCode: string;
  objective: string;
  appealAxis: string;
  creativeSummary: string;
  platform: string;
  winRate: number;
  sampleSize: number;
  liftPct: number | null;
  createdAt: Date;
};

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  private toDto(row: KnowRow): KnowledgeAssetDto {
    return {
      id: row.id,
      scope: row.tenantId === null ? 'shared' : 'own',
      industryCode: row.industryCode,
      industryLabel: benchmarkFor(row.industryCode).label,
      objective: row.objective as KnowledgeAssetDto['objective'],
      appealAxis: row.appealAxis,
      creativeSummary: row.creativeSummary,
      platform: row.platform,
      winRate: row.winRate,
      sampleSize: row.sampleSize,
      liftPct: row.liftPct,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 業種×目的で検索。RLSにより own(自テナント)+shared(tenantId NULL) が可視 */
  async search(
    tenantId: string,
    filter: { industryCode?: string; objective?: string },
  ): Promise<KnowledgeSearchDto> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.knowledgeAsset.findMany({
        where: {
          ...(filter.industryCode ? { industryCode: filter.industryCode } : {}),
          ...(filter.objective ? { objective: filter.objective } : {}),
        },
        orderBy: [{ winRate: 'desc' }, { sampleSize: 'desc' }],
        take: 100,
      }),
    );
    const dtos = rows.map((r) => this.toDto(r as KnowRow));
    return {
      own: dtos.filter((d) => d.scope === 'own'),
      shared: dtos.filter((d) => d.scope === 'shared'),
    };
  }

  /** /copy へ反映する上位パターン (業種×目的でスコア降順) */
  async topFor(tenantId: string, industryCode: string, limit = 3): Promise<KnowledgeAssetDto[]> {
    const { own, shared } = await this.search(tenantId, { industryCode });
    return [...own, ...shared]
      .sort((a, b) => b.winRate * Math.log(b.sampleSize + 1) - a.winRate * Math.log(a.sampleSize + 1))
      .slice(0, limit);
  }

  /**
   * A/Bテストの勝者を勝ちパターンとして昇格 (B-3→B-1連携)。
   * shareAnonymized=true なら匿名化して共有ナレッジ (tenantId NULL) にも登録。
   */
  async promoteFromAbTest(tenantId: string, input: PromoteAbTestInput): Promise<KnowledgeAssetDto> {
    if (!input?.abTestId || !input?.appealAxis?.trim() || !input?.creativeSummary?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '訴求軸・クリエイティブ要約は必須です。',
        '昇格するパターンの内容を入力してください。',
      );
    }
    const created = await this.prisma.withTenant(tenantId, async (tx) => {
      const test = await tx.abTest.findUnique({ where: { id: input.abTestId }, include: { client: true } });
      if (!test) throw new AppError(HttpStatus.NOT_FOUND, 'A/Bテストが見つかりません。', '一覧を再読込してください。');
      // 勝者はレートから再計算する (test.winner は conclude 後のみ設定されるため信頼しない)
      const isCtr = test.metric === 'ctr';
      const aDen = isCtr ? test.aImpr : test.aClicks;
      const bDen = isCtr ? test.bImpr : test.bClicks;
      const aNum = isCtr ? test.aClicks : test.aConv;
      const bNum = isCtr ? test.bClicks : test.bConv;
      const aRate = aDen > 0 ? aNum / aDen : 0;
      const bRate = bDen > 0 ? bNum / bDen : 0;
      const bWins = bRate >= aRate;
      const winRate = bWins ? bRate : aRate;
      const loserRate = bWins ? aRate : bRate;
      const sampleSize = bWins ? bNum : aNum;
      const liftPct = loserRate > 0 ? +(((winRate - loserRate) / loserRate) * 100).toFixed(1) : null;

      const base = {
        industryCode: test.client.industryCode,
        objective: input.objective ?? 'conversion',
        appealAxis: input.appealAxis.trim(),
        creativeSummary: input.creativeSummary.trim(),
        winRate: +winRate.toFixed(4),
        sampleSize,
        liftPct,
      };
      // 自テナントのナレッジ
      const own = await tx.knowledgeAsset.create({ data: { tenantId, sourceAnonymized: false, ...base } });
      // オプトインなら匿名化して共有ナレッジにも (クライアント名・実額は含めない)
      if (input.shareAnonymized) {
        await tx.knowledgeAsset.create({ data: { tenantId: null, sourceAnonymized: true, ...base } });
      }
      return own;
    });

    await this.trail.record({
      tenantId,
      action: 'knowledge_promote',
      resource: created.id,
      detail: { abTestId: input.abTestId, shared: !!input.shareAnonymized },
    });
    return this.toDto(created as KnowRow);
  }
}
