import { HttpStatus, Injectable } from '@nestjs/common';
import type { LaunchSheetDto, Platform, ProjectBrief, ProjectSettings } from '@adgrid/shared';
import { DEFAULT_PROJECT_BRIEF, DEFAULT_PROJECT_SETTINGS, buildLaunchSheet, hasAdSpec } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

/**
 * 媒体別 入稿シート (F-58)。
 * API入稿ができない媒体 (LINE等は認定パートナー限定) でも、管理画面へ手入力する際に
 * 「その媒体の規定に合った最良の設定」を再現できるよう、変換済みの入稿指示書を返す。
 */
@Injectable()
export class LaunchSheetService {
  constructor(private readonly prisma: PrismaService) {}

  async sheet(tenantId: string, projectId: string, platform: Platform): Promise<LaunchSheetDto> {
    if (!hasAdSpec(platform)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'この媒体の入稿仕様はまだ登録されていません。',
        'Google広告・Yahoo!・Meta・LINE・TikTok に対応しています。',
      );
    }
    const data = await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId }, include: { client: true } });
      if (!project) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      const assets = await tx.projectAsset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
      return { project, assets };
    });

    const brief = { ...DEFAULT_PROJECT_BRIEF, ...((data.project.brief ?? {}) as Partial<ProjectBrief>) } as ProjectBrief;
    const s = { ...DEFAULT_PROJECT_SETTINGS, ...((data.project.settings ?? {}) as Partial<ProjectSettings>) } as ProjectSettings;

    const copies = data.assets.filter((a) => a.type === 'copy');
    const lp = data.assets.find((a) => a.type === 'lp' && /^https?:\/\//i.test(a.url));

    const sheet = buildLaunchSheet({
      platform,
      clientName: data.project.client.name,
      projectName: data.project.name,
      // 見出し=制作物タイトル / 説明文・本文=本文。媒体ごとに上限が違うため変換側で切り分ける
      headlines: copies.map((c) => c.title),
      descriptions: copies.map((c) => c.content),
      primaryTexts: copies.map((c) => c.content),
      keywords: (s.keywords ?? '').split(/[\n,、,]/).map((k) => k.trim()).filter(Boolean),
      negatives: (s.exclusions ?? '').split(/[\n,、,]/).map((k) => k.trim()).filter(Boolean),
      monthlyBudget: s.monthlyBudgetTotal ?? 0,
      targetCpa: s.targetCpa,
      finalUrl: lp?.url ?? '',
      regions: s.regions,
      audience: [s.audience, s.retargeting ? 'リターゲティング有効' : '', s.lookalike ? '類似オーディエンス有効' : '']
        .filter(Boolean).join(' / '),
      startDate: s.startDate,
      endDate: s.endDate,
    });
    if (!sheet) {
      throw new AppError(HttpStatus.BAD_REQUEST, '入稿シートを作成できませんでした。', '媒体を選び直してください。');
    }
    return sheet;
  }
}
