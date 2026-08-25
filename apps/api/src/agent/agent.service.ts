import { HttpStatus, Injectable } from '@nestjs/common';
import type { AgentRunDto, AgentStep, ProjectGoal, ProjectSettings } from '@adgrid/shared';
import { BID_STRATEGY_LABEL, DEFAULT_PROJECT_SETTINGS, PROJECT_GOAL_LABEL, buildKpiTree, parseInstruction, recommendMediaPlan } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { ProjectsService } from '../projects/projects.service';
import { KeywordPlanService } from '../projects/keyword-plan.service';
import { LaunchService } from '../projects/launch.service';

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
    private readonly keywordPlan: KeywordPlanService,
    private readonly launch: LaunchService,
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
    const acquisition = goal === 'conversion' || goal === 'store';
    const patch: Partial<ProjectSettings> = {
      budgetType: 'monthly',
      monthlyBudgetTotal: budget,
      dailyBudget: Math.round(budget / 30),
      pacing: 'standard',
      bidStrategy: plan.bidStrategy,
      targetCpa: hints.targetCpa ?? plan.targetCpa,
      targetCv: hints.targetCv ?? plan.expectedCv,
      targetRoas: plan.targetRoas,
      regions: hints.regions ?? plan.targeting.regions,
      ageRange: hints.ageRange ?? plan.targeting.ageRange,
      gender: hints.gender ?? plan.targeting.gender,
      devices: plan.targeting.devices,
      language: '日本語',
      // 獲得系は再訪への再配信が効く。認知は類似で新規リーチを広げる
      retargeting: acquisition,
      lookalike: goal === 'awareness' || goal === 'conversion',
      exclusions: acquisition ? '既存顧客（購入済み）を除外' : '',
      placements: '自動（推奨）',
      frequencyCap: goal === 'awareness' ? '3回/週' : '',
      conversionPoint: plan.conversionPoint,
    };
    await this.projects.update(tenantId, projectId, { settings: patch });
    const appliedSettings: ProjectSettings = { ...current, ...patch };
    const genderLabel = patch.gender === 'female' ? '女性' : patch.gender === 'male' ? '男性' : '指定なし';
    const audienceNote = [patch.retargeting ? 'リタゲ' : '', patch.lookalike ? '類似' : '', patch.exclusions ? `除外:${patch.exclusions}` : ''].filter(Boolean).join('・');
    steps.push({
      key: 'settings', title: '③ 配信設定を反映（金額・入札・ターゲティング）',
      detail: `月予算${budget.toLocaleString()}円 / 入札=${BID_STRATEGY_LABEL[appliedSettings.bidStrategy]}(目標CPA${appliedSettings.targetCpa?.toLocaleString() ?? '—'}円) / ${patch.regions}・${patch.ageRange}・${genderLabel}${audienceNote ? ' / ' + audienceNote : ''} / CV地点=${patch.conversionPoint}`,
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

    // ステップ5: 検索キーワードを自動設計し配信設定へ反映 (CPAを決める最重要要素)
    let kwDetail = 'キーワードを設計できませんでした。「② 配信設定」で手入力してください。';
    try {
      const kp = await this.keywordPlan.plan(tenantId, projectId);
      const applied = await this.keywordPlan.apply(tenantId, projectId, kp);
      const nowCount = kp.keywords.filter((k) => k.tier === 'now').length;
      kwDetail = `検索意図の強い語を中心に ${applied.keywordCount}語（うち今すぐ客 ${nowCount}語）を設定。無駄クリックを防ぐ除外キーワード ${applied.negativeCount}語も登録`;
    } catch {
      /* キーワード設計の失敗で一気通貫を止めない */
    }
    steps.push({ key: 'keywords', title: '⑤ 検索キーワードを自動設計', detail: kwDetail, status: 'done' });

    // ステップ6: 入稿準備 (実際の入稿は承認者の確認を通す)
    let launchDetail = '「④ 掲示」の「Google広告へ入稿」から、一時停止の状態でキャンペーンを作成できます。';
    let launchReady = false;
    try {
      const lp = await this.launch.plan(tenantId, projectId);
      launchReady = lp.ready;
      launchDetail = lp.ready
        ? `入稿準備が整いました（日予算${Math.round(lp.dailyBudget).toLocaleString('ja-JP')}円 / 見出し${lp.headlines.length}本 / キーワード${lp.keywords.length}語）。「④ 掲示」の「入稿する」で一時停止のまま作成できます。`
        : `あと少しで入稿できます: ${lp.issues[0]}`;
    } catch {
      /* 入稿プランが作れない場合も他ステップの結果は返す */
    }
    steps.push({ key: 'publish', title: '⑥ 入稿準備 → 公開', detail: launchDetail, status: launchReady ? 'done' : 'todo' });

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
