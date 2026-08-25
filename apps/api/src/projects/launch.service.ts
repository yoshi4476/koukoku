import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { LaunchPlanDto, LaunchResultDto, ProjectSettings } from '@adgrid/shared';
import { DEFAULT_PROJECT_SETTINGS } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import type { SessionInfoValue } from '../common/tenant';
import { GoogleAdsConnector } from '../media-connector/google-ads.connector';
import { ChangeLogService } from '../changelog/changelog.service';

/**
 * プロジェクトからGoogle広告へ実入稿する (F-56)。
 * ADGRIDの「制作物 + 配信設定」を、キャンペーン/広告グループ/キーワード/広告に変換する。
 *
 * 安全設計:
 *  - 作成は必ず一時停止(PAUSED)。配信開始は別操作 (課金の開始を明示的にする)
 *  - 実行はオーナー/管理者のみ。全操作を変更履歴と監査ログに記録する
 */
@Injectable()
export class LaunchService {
  private readonly logger = new Logger(LaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
    private readonly changelog: ChangeLogService,
  ) {}

  private connector(tenantId: string): GoogleAdsConnector {
    return new GoogleAdsConnector(this.prisma, tenantId);
  }

  /** プロジェクトの内容から入稿プランを組み立てる (実行前の確認用。API呼出なし) */
  async plan(tenantId: string, projectId: string): Promise<LaunchPlanDto> {
    const data = await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: { client: true, adAccounts: true },
      });
      if (!project) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      const assets = await tx.projectAsset.findMany({ where: { projectId } });
      return { project, assets };
    });

    const s = { ...DEFAULT_PROJECT_SETTINGS, ...((data.project.settings ?? {}) as Partial<ProjectSettings>) } as ProjectSettings;
    const copies = data.assets.filter((a) => a.type === 'copy');
    const lp = data.assets.find((a) => a.type === 'lp' && /^https?:\/\//i.test(a.url));

    // 見出し=制作物のタイトル、説明文=本文。足りない分は不足として返す
    const headlines = copies.map((c) => c.title.trim()).filter(Boolean);
    const descriptions = copies.map((c) => c.content.trim()).filter(Boolean);
    const keywords = (s.keywords ?? '')
      .split(/[\n,、,]/).map((k) => k.trim()).filter(Boolean);

    const monthly = s.monthlyBudgetTotal ?? 0;
    const dailyBudget = monthly > 0 ? Math.round(monthly / 30.4) : 0;

    const issues: string[] = [];
    if (headlines.length < 3) issues.push(`見出しが${headlines.length}本です。Google広告には3本以上必要です（「③ 制作物」で広告文を追加）。`);
    if (descriptions.length < 2) issues.push(`説明文が${descriptions.length}本です。2本以上必要です。`);
    if (!lp) issues.push('リンク先LPのURLが未設定です（「③ 制作物」でLPにURLを設定）。');
    if (dailyBudget <= 0) issues.push('月予算が未設定です（「② 配信設定」で月予算を入力）。');
    if (keywords.length === 0) issues.push('キーワードが未設定です（「② 配信設定」のキーワード欄に入力）。');

    const googleAccounts = data.project.adAccounts.filter((a) => a.platform === 'google_ads');
    if (googleAccounts.length === 0) issues.push('このプロジェクトにGoogle広告アカウントが紐付いていません（「④ 掲示」で確認）。');

    return {
      projectName: data.project.name,
      clientName: data.project.client.name,
      accounts: googleAccounts.map((a) => ({ adAccountId: a.id, externalAccountId: a.externalAccountId, name: a.name })),
      campaignName: `${data.project.client.name} ${data.project.name}`,
      dailyBudget,
      monthlyBudget: monthly,
      targetCpa: s.targetCpa,
      finalUrl: lp?.url ?? '',
      headlines: headlines.slice(0, 15),
      descriptions: descriptions.slice(0, 4),
      keywords: keywords.slice(0, 100),
      startDate: s.startDate,
      endDate: s.endDate,
      issues,
      ready: issues.length === 0,
    };
  }

  /** 実入稿。必ず一時停止で作成する */
  async launch(tenantId: string, projectId: string, user: SessionInfoValue, adAccountId?: string): Promise<LaunchResultDto> {
    const plan = await this.plan(tenantId, projectId);
    if (!plan.ready) {
      throw new AppError(HttpStatus.BAD_REQUEST, '入稿の準備が整っていません。', plan.issues[0] ?? '不足項目を解消してください。');
    }
    const target = adAccountId
      ? plan.accounts.find((a) => a.adAccountId === adAccountId)
      : plan.accounts[0];
    if (!target) {
      throw new AppError(HttpStatus.BAD_REQUEST, '入稿先のアカウントが選択されていません。', 'Google広告アカウントを選んでください。');
    }

    const res = await this.connector(tenantId).createSearchCampaign({
      customerId: target.externalAccountId,
      campaignName: plan.campaignName,
      dailyBudgetYen: plan.dailyBudget,
      finalUrl: plan.finalUrl,
      headlines: plan.headlines,
      descriptions: plan.descriptions,
      keywords: plan.keywords,
      targetCpaYen: plan.targetCpa,
      startDate: plan.startDate,
      endDate: plan.endDate,
    });

    await this.changelog.record({
      tenantId,
      adAccountId: target.adAccountId,
      actor: 'adgrid',
      actorName: user.userId ?? '運用担当',
      entity: 'campaign',
      field: 'status',
      oldValue: '',
      newValue: 'PAUSED',
      note: `ADGRIDから新規入稿: ${plan.campaignName} (キーワード${res.keywordCount}語)`,
    });
    await this.trail.record({
      tenantId, userId: user.userId, action: 'campaign_created', resource: projectId,
      detail: { campaignId: res.campaignId, adGroupId: res.adGroupId, keywords: res.keywordCount, account: target.externalAccountId },
    });

    return {
      campaignId: res.campaignId,
      adGroupId: res.adGroupId,
      keywordCount: res.keywordCount,
      status: 'PAUSED',
      accountName: target.name,
      message: `「${plan.campaignName}」を一時停止の状態で作成しました。内容を確認してから配信を開始してください。`,
    };
  }

  /** 配信開始 (PAUSED → ENABLED)。ここから課金が始まる */
  async enable(tenantId: string, projectId: string, user: SessionInfoValue, input: { externalAccountId: string; campaignId: string }): Promise<{ ok: true; message: string }> {
    if (!input?.externalAccountId || !input?.campaignId) {
      throw new AppError(HttpStatus.BAD_REQUEST, '対象キャンペーンが指定されていません。', '入稿結果からもう一度お試しください。');
    }
    const acc = await this.prisma.withTenant(tenantId, (tx) =>
      tx.adAccount.findFirst({ where: { externalAccountId: input.externalAccountId, platform: 'google_ads' } }),
    );
    if (!acc) {
      throw new AppError(HttpStatus.NOT_FOUND, '対象アカウントが見つかりません。', 'アカウントを選び直してください。');
    }
    await this.connector(tenantId).enableCampaign(input.externalAccountId, input.campaignId);

    await this.changelog.record({
      tenantId, adAccountId: acc.id, actor: 'adgrid', actorName: user.userId ?? '運用担当',
      entity: 'campaign', field: 'status', oldValue: 'PAUSED', newValue: 'ENABLED',
      note: 'ADGRIDから配信開始',
    });
    await this.trail.record({
      tenantId, userId: user.userId, action: 'campaign_enabled', resource: projectId,
      detail: { campaignId: input.campaignId, account: input.externalAccountId },
    });
    return { ok: true, message: '配信を開始しました。以後の消化は「⑤ 成果」で確認できます。' };
  }
}
