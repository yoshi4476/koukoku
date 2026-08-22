import { HttpStatus, Injectable } from '@nestjs/common';
import type { AgentRunDto, AgentStep, ProjectGoal, ProjectSettings } from '@adgrid/shared';
import { BID_STRATEGY_LABEL, DEFAULT_PROJECT_SETTINGS, PROJECT_GOAL_LABEL, buildKpiTree, parseInstruction, recommendMediaPlan } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { ProjectsService } from '../projects/projects.service';

/**
 * AI運用エージェント (F-43)。1つの指示から、AIが最適な順序で
 * 目標→予算逆算→媒体配分→配信設定→制作物生成→公開準備 まで一気通貫で実行する。
 * 公開自体は承認者の最終確認を残す(暴走防止)。
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async run(tenantId: string, projectId: string, instruction: string, scope?: string | null): Promise<AgentRunDto> {
    if (!instruction?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, '指示が空です。', '「月30万で来店予約を増やして」のように指示してください。');
    }
    const project = await this.prisma.withTenant(tenantId, (tx) =>
      tx.project.findUnique({ where: { id: projectId }, include: { client: true } }),
    );
    if (!project || (scope && project.clientId !== scope)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
    }
    const industryCode = project.client.industryCode;
    const hints = parseInstruction(instruction);
    const goal: ProjectGoal = hints.goalHint ?? (project.goal as ProjectGoal);
    const current: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS, ...(project.settings as object) };
    const steps: AgentStep[] = [];

    // ステップ1: 目標と予算 (指示に目標CVがあればKPI逆算で必要予算を算出)
    let budget = hints.budget ?? null;
    let goalDetail = '';
    if (!budget && hints.targetCv) {
      const kpi = buildKpiTree({ industryCode, targetCv: hints.targetCv, targetCpa: hints.targetCpa });
      budget = kpi.monthlyBudget;
      goalDetail = `目標CV ${hints.targetCv.toLocaleString()}件 から必要月予算 ${budget.toLocaleString()}円 を逆算（相場CVR ${kpi.cvr}% / CTR ${kpi.ctr}%）`;
    }
    if (!budget || budget <= 0) budget = current.monthlyBudgetTotal ?? 500000;
    if (!goalDetail) goalDetail = `月予算 ${budget.toLocaleString()}円・目的「${PROJECT_GOAL_LABEL[goal]}」で計画`;
    steps.push({ key: 'goal', title: '① 目標と予算を決定', detail: goalDetail, status: 'done' });

    // ステップ2: 最適な媒体配分
    const plan = recommendMediaPlan(industryCode, goal, budget);
    steps.push({
      key: 'media', title: '② 最適な媒体配分を設計',
      detail: plan.media.map((m) => `${m.label} ${m.sharePct}%(${m.monthlyBudget.toLocaleString()}円)`).join(' / '),
      status: 'done',
    });

    // ステップ3: 配信設定(金額・入札・ターゲティング)を反映
    const patch: Partial<ProjectSettings> = {
      monthlyBudgetTotal: budget,
      dailyBudget: Math.round(budget / 30),
      targetCpa: hints.targetCpa ?? plan.targetCpa,
      targetCv: hints.targetCv ?? plan.expectedCv,
      targetRoas: plan.targetRoas,
      bidStrategy: plan.bidStrategy,
      regions: hints.regions ?? plan.targeting.regions,
      ageRange: hints.ageRange ?? plan.targeting.ageRange,
      gender: hints.gender ?? plan.targeting.gender,
      devices: plan.targeting.devices,
      conversionPoint: plan.conversionPoint,
    };
    await this.projects.update(tenantId, projectId, { settings: patch });
    const appliedSettings: ProjectSettings = { ...current, ...patch };
    const genderLabel = patch.gender === 'female' ? '女性' : patch.gender === 'male' ? '男性' : '指定なし';
    steps.push({
      key: 'settings', title: '③ 配信設定を反映',
      detail: `入札=${BID_STRATEGY_LABEL[appliedSettings.bidStrategy]} / 目標CPA ${appliedSettings.targetCpa?.toLocaleString() ?? '—'}円 / ${patch.regions}・${patch.ageRange}・${genderLabel} / CV地点=${patch.conversionPoint}`,
      status: 'done',
    });

    // ステップ4: クリエイティブをAIで生成し下書き登録
    const gen = await this.projects.generateCreatives(tenantId, projectId, 3, scope);
    const adopted = await this.projects.adoptCreatives(tenantId, projectId, { variants: gen.variants.slice(0, 3) });
    steps.push({
      key: 'creative', title: '④ クリエイティブをAIで生成',
      detail: `業種特化の広告案 ${adopted.length}件を下書き登録（${gen.mocked ? 'テンプレ生成' : 'AI生成'}）`,
      status: 'done',
    });

    // ステップ5: プレビュー・公開準備 (公開は最終確認を残す)
    steps.push({
      key: 'publish', title: '⑤ プレビュー → 公開準備',
      detail: '制作物タブで見え方を確認し、「公開前チェック」→各制作物の「公開」で配信できます。公開は承認者の最終確認を通します。',
      status: 'done',
    });

    return {
      mocked: gen.mocked,
      instruction: instruction.trim(),
      goal,
      steps,
      appliedSettings,
      createdAssetTitles: adopted.map((a) => a.title),
      mediaPlan: plan.media.map((m) => ({ platformLabel: m.label, monthlyBudget: m.monthlyBudget, sharePct: m.sharePct })),
      expectedCv: plan.expectedCv,
      readyToPublish: true,
    };
  }
}
