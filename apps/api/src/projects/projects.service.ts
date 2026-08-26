import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AssetAdviceDto,
  AssetAdviceItem,
  AssetStatus,
  AssetType,
  AuditResult,
  BudgetPlanDto,
  BudgetPlanItemDto,
  ConnectionStatus,
  CreateAssetInput,
  CreateProjectInput,
  FatigueItemDto,
  FatigueLevel,
  FatigueReportDto,
  KpiProgressDto,
  PaceStatus,
  Platform,
  PreflightDto,
  PreflightIssue,
  ReviewIssueDto,
  ReviewSimDto,
  ReviewVerdict,
  RotationAction,
  UndeployableAsset,
  ProjectAccountDto,
  ProjectAssetDto,
  ProjectBrief,
  ProjectDetailDto,
  ProjectDto,
  ProjectGoal,
  ProjectSettings,
  ProjectStatus,
  UpdateAssetInput,
  UpdateProjectInput,
} from '@adgrid/shared';
import type { AdoptCreativeInput, CreativeGenDto, CreativeVariant } from '@adgrid/shared';
import { CreativeGenResultSchema, DEFAULT_PROJECT_BRIEF, DEFAULT_PROJECT_SETTINGS, assetTypeFitReason, buildCreativeVariants, creativeVariantFromLlm, industryProfileFor } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';
import { AlertsService } from '../alerts/alerts.service';
import { TrailService } from '../common/trail.service';
import { LlmService } from '../ai/llm.service';
import { PROMPTS, OUTPUT_SCHEMAS } from '../ai/prompt-registry';
import { scanLawDictionary } from '../ai/law-dictionary';
import { widthUnits } from '../ai/copy-limits';
import type { SessionInfoValue } from '../common/tenant';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { ALLOWED_UPLOAD, MAX_UPLOAD_BYTES, UPLOAD_DIR } from './upload.constants';

const GOALS: ProjectGoal[] = ['conversion', 'awareness', 'traffic', 'store'];
const ASSET_TYPES: AssetType[] = ['copy', 'lp', 'flyer'];
const ASSET_STATUSES: AssetStatus[] = ['draft', 'review', 'approved', 'published'];

type AssetRow = {
  id: string; projectId: string; type: string; title: string; content: string;
  url: string; status: string; note: string; createdAt: Date; publishedAt: Date | null;
};
function toAssetDto(r: AssetRow): ProjectAssetDto {
  return {
    id: r.id, projectId: r.projectId, type: r.type as AssetType, title: r.title,
    content: r.content, url: r.url, status: r.status as AssetStatus, note: r.note,
    createdAt: r.createdAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
    private readonly llm: LlmService,
    private readonly trail: TrailService,
  ) {}

  private cpa(cost: number, conv: number): number | null {
    return conv > 0 ? Math.round(cost / conv) : null;
  }

  /** アカウント群の最新診断から未対応指摘数を数える。各アカウントの最新1件のみを対象 */
  private async openFindingsFor(tx: Tx, accountIds: string[]): Promise<number> {
    const map = await this.openFindingsByAccount(tx, accountIds);
    let open = 0;
    for (const id of accountIds) open += map.get(id) ?? 0;
    return open;
  }

  /** アカウント別の未対応指摘数を1クエリで一括取得 (一覧のN+1回避)。Map<adAccountId, number> */
  private async openFindingsByAccount(tx: Tx, accountIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (accountIds.length === 0) return map;
    // distinct でアカウントごとに最新の診断だけを取得 (件数上限による取りこぼしを防ぐ)
    const audits = await tx.audit.findMany({
      where: { adAccountId: { in: accountIds } },
      orderBy: [{ adAccountId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['adAccountId'],
    });
    for (const a of audits) {
      const statuses = (a.findingStatuses ?? {}) as Record<string, string>;
      let open = 0;
      for (const f of (a.result as unknown as AuditResult).findings ?? []) {
        if ((statuses[String(f.priority_rank)] ?? 'open') === 'open') open++;
      }
      map.set(a.adAccountId, open);
    }
    return map;
  }

  async list(tenantId: string, scope?: string | null): Promise<ProjectDto[]> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const projects = await tx.project.findMany({
        where: scope ? { clientId: scope } : undefined,
        include: {
          client: true,
          adAccounts: { select: { id: true, platform: true } },
          assets: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      // N+1回避: 全プロジェクトのアカウント/クライアントをまとめ、集計・診断・レポートを一括取得
      const allAccountIds = projects.flatMap((p) => p.adAccounts.map((a) => a.id));
      const clientIds = [...new Set(projects.map((p) => p.clientId))];
      const [curByAcc, prevByAcc, findingsByAcc, reports] = await Promise.all([
        this.metrics.totalsByAccount(tx, allAccountIds, daysAgo(6), daysAgo(0)),
        this.metrics.totalsByAccount(tx, allAccountIds, daysAgo(13), daysAgo(7)),
        this.openFindingsByAccount(tx, allAccountIds),
        clientIds.length
          ? tx.report.findMany({ where: { clientId: { in: clientIds } }, orderBy: { createdAt: 'desc' } })
          : Promise.resolve([]),
      ]);
      const lastReportByClient = new Map<string, Date>();
      for (const r of reports) if (!lastReportByClient.has(r.clientId)) lastReportByClient.set(r.clientId, r.createdAt);

      const out: ProjectDto[] = [];
      for (const p of projects) {
        const accountIds = p.adAccounts.map((a) => a.id);
        const cur = MetricsService.sumTotals(curByAcc, accountIds);
        const prev = MetricsService.sumTotals(prevByAcc, accountIds);
        const lastReportAt = lastReportByClient.get(p.clientId) ?? null;
        const openFindings = accountIds.reduce((s, id) => s + (findingsByAcc.get(id) ?? 0), 0);
        const settingsOf = this.mergeSettings(p.settings);
        const cpa = this.cpa(cur.cost, cur.conversions);
        const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
        const acctSet = new Set(accountIds);
        out.push({
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: p.client.name,
          industryCode: p.client.industryCode,
          goal: p.goal as ProjectGoal,
          status: p.status as ProjectStatus,
          note: p.note,
          accountCount: accountIds.length,
          platforms: [...new Set(p.adAccounts.map((a) => a.platform))] as Platform[],
          cost7d: cur.cost,
          conversions7d: +cur.conversions.toFixed(1),
          cpa7d: cpa,
          cpaDelta: cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
          alertCount: events.filter((e) => acctSet.has(e.adAccountId)).length,
          openFindings,
          assetCount: p.assets.length,
          publishedCount: p.assets.filter((a) => a.status === 'published').length,
          lastReportAt: lastReportAt?.toISOString() ?? null,
          startDate: settingsOf.startDate,
          endDate: settingsOf.endDate,
          monthlyBudget: settingsOf.monthlyBudgetTotal,
          createdAt: p.createdAt.toISOString(),
        });
      }
      return out;
    });
  }

  async detail(tenantId: string, id: string, scope?: string | null): Promise<ProjectDetailDto> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.project.findUnique({
        where: { id },
        include: {
          client: true,
          adAccounts: { orderBy: { name: 'asc' } },
          assets: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!p || (scope && p.clientId !== scope)) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const accountIds = p.adAccounts.map((a) => a.id);
      const connections = await tx.mediaConnection.findMany({});
      const connMap = new Map(connections.map((c) => [c.platform, c]));

      const [cur, prev, trend, lastReport, openFindings] = await Promise.all([
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(6), daysAgo(0)),
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(7)),
        this.metrics.dailyTrend(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(0)),
        tx.report.findFirst({ where: { clientId: p.clientId }, orderBy: { createdAt: 'desc' } }),
        this.openFindingsFor(tx, accountIds),
      ]);

      const accounts: ProjectAccountDto[] = [];
      for (const a of p.adAccounts) {
        const t = await this.metrics.totals(tx, { adAccountId: a.id }, daysAgo(6), daysAgo(0));
        const conn = connMap.get(a.platform);
        accounts.push({
          adAccountId: a.id,
          name: a.name,
          platform: a.platform as Platform,
          connectionStatus: (conn?.status ?? 'not_connected') as ConnectionStatus,
          monthlyBudget: a.monthlyBudget ? Number(a.monthlyBudget) : null,
          cost7d: t.cost,
          conversions7d: +t.conversions.toFixed(1),
          cpa7d: this.cpa(t.cost, t.conversions),
        });
      }
      const acctSet = new Set(accountIds);
      const settings = this.mergeSettings(p.settings);

      return {
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.client.name,
        industryCode: p.client.industryCode,
        goal: p.goal as ProjectGoal,
        status: p.status as ProjectStatus,
        note: p.note,
        kpi: this.metrics.kpiFromTotals(cur, prev),
        trend,
        accounts,
        alerts: events.filter((e) => acctSet.has(e.adAccountId)),
        openFindings,
        assets: (p.assets as AssetRow[]).map(toAssetDto),
        settings,
        brief: this.mergeBrief(p.brief),
        kpiProgress: await this.computeKpi(tx, accountIds, settings),
        lastReportAt: lastReport?.createdAt.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  /** 当月の目標(KPI)進捗。当月消化・CVを月末へ線形予測し目標と比較 (F-21) */
  private async computeKpi(tx: Tx, accountIds: string[], settings: ProjectSettings): Promise<KpiProgressDto> {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const t = accountIds.length
      ? await this.metrics.totals(tx, { adAccountIds: accountIds }, monthStart, daysAgo(0))
      : { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
    // 実データのある最終日を基準に線形予測する (当日ぶんは同期遅延で未反映のことが多く、
    // 経過日数で割ると過小予測になるため、実績が乗っている日数で割る)
    const maxDate = accountIds.length
      ? (await tx.factAdPerformance.aggregate({
          where: { adAccountId: { in: accountIds }, date: { gte: monthStart, lte: daysAgo(0) } },
          _max: { date: true },
        }))._max.date
      : null;
    const dataDays = maxDate ? Math.max(1, maxDate.getUTCDate()) : daysElapsed;
    const project = (v: number) => (dataDays > 0 ? Math.round((v / dataDays) * daysInMonth) : 0);
    const projectedCv = dataDays > 0 ? +((t.conversions / dataDays) * daysInMonth).toFixed(1) : 0;
    const actualCv = +t.conversions.toFixed(1);
    const actualCpa = t.conversions > 0 ? Math.round(t.cost / t.conversions) : null;

    let cvStatus: PaceStatus = 'none';
    if (settings.targetCv && settings.targetCv > 0) {
      cvStatus = projectedCv >= settings.targetCv * 1.05 ? 'ahead' : projectedCv >= settings.targetCv * 0.9 ? 'ontrack' : 'behind';
    }
    let cpaStatus: KpiProgressDto['cpa']['status'] = 'none';
    if (settings.targetCpa && actualCpa !== null) {
      cpaStatus = actualCpa <= settings.targetCpa ? 'good' : actualCpa <= settings.targetCpa * 1.2 ? 'warn' : 'bad';
    }
    return {
      daysElapsed,
      daysInMonth,
      cv: {
        target: settings.targetCv,
        actual: actualCv,
        projected: projectedCv,
        pct: settings.targetCv ? Math.round((projectedCv / settings.targetCv) * 100) : null,
        status: cvStatus,
      },
      cpa: { target: settings.targetCpa, actual: actualCpa, status: cpaStatus },
      spend: {
        budget: settings.monthlyBudgetTotal,
        actual: Math.round(t.cost),
        projected: project(t.cost),
        pct: settings.monthlyBudgetTotal ? Math.round((project(t.cost) / settings.monthlyBudgetTotal) * 100) : null,
      },
    };
  }

  /** 媒体審査シミュレーション。公開前に審査で落ちやすい表現を検知 (F-21) */
  async reviewAsset(tenantId: string, assetId: string, scope?: string | null): Promise<ReviewSimDto> {
    const asset = await this.prisma.withTenant(tenantId, (tx) =>
      tx.projectAsset.findUnique({ where: { id: assetId }, include: { project: { include: { client: true } } } }),
    );
    if (!asset || (scope && asset.project.clientId !== scope)) {
      throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
    }
    const profile = industryProfileFor(asset.project.client.industryCode);
    const text = `${asset.title} ${asset.content}`.trim();
    const issues: ReviewIssueDto[] = [];

    for (const w of scanLawDictionary(text)) {
      issues.push({ severity: w.severity, scope: w.law, expression: w.expression, reason: w.reason, suggestion: w.suggestion });
    }
    for (const ng of profile.ngWords) {
      if (text.includes(ng) && !issues.some((i) => i.expression === ng)) {
        issues.push({ severity: 'warn', scope: `${profile.label}の規制`, expression: ng, reason: '業種の審査基準で問題になりやすい表現です。', suggestion: '根拠を明示するか、表現を緩和してください。' });
      }
    }
    // 媒体共通ポリシー (最上級・断定・個人属性の名指し・誇大)
    const MEDIA: { re: RegExp; expr: string; reason: string; suggestion: string; severity: 'block' | 'warn' }[] = [
      { re: /(No\.?1|ナンバーワン|日本一|世界一|業界一|最高|最安|最強)/, expr: '最上級表現', reason: '客観的な調査根拠がないと不当表示・媒体審査でNGになりやすい。', suggestion: '「(自社調べ)」等の根拠併記か、表現を外す。', severity: 'warn' },
      { re: /(絶対|必ず|確実に|100%|誰でも)/, expr: '断定・保証表現', reason: '効果や結果の保証は多くの媒体で禁止。', suggestion: '「〜の場合があります」等に緩和。', severity: 'warn' },
      { re: /(あなた|お前|太っている|貧乏|独身).{0,6}(ですか|あなた)/, expr: '個人属性の名指し', reason: 'Meta等では個人属性を断定・示唆する表現は不承認。', suggestion: '悩みは一般化して表現する。', severity: 'warn' },
      { re: /(簡単に|楽して|寝るだけで).{0,6}(稼|痩|治)/, expr: '誇大表現', reason: '容易な成果の断定は誇大広告とみなされやすい。', suggestion: '条件や個人差を明記。', severity: 'warn' },
    ];
    for (const m of MEDIA) {
      if (m.re.test(text) && !issues.some((i) => i.expression === m.expr)) {
        issues.push({ severity: m.severity, scope: '媒体共通ポリシー', expression: m.expr, reason: m.reason, suggestion: m.suggestion });
      }
    }

    const hasBlock = issues.some((i) => i.severity === 'block');
    const verdict: ReviewVerdict = hasBlock ? 'risk' : issues.length > 0 ? 'caution' : 'pass';
    const note =
      verdict === 'pass'
        ? '主要な審査観点で問題は見つかりませんでした。ただし最終判断は各媒体の審査に依存します。'
        : verdict === 'risk'
          ? '却下リスクの高い表現があります。公開前に必ず修正してください。'
          : '修正推奨の表現があります。根拠明示か緩和で通過率が上がります。';
    return { assetId, verdict, issues, note };
  }

  /** 保存済みJSONを既定値とマージし、欠損なしの ProjectSettings にする */
  private mergeSettings(raw: unknown): ProjectSettings {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProjectSettings>;
    return { ...DEFAULT_PROJECT_SETTINGS, ...s };
  }

  private mergeBrief(raw: unknown): ProjectBrief {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProjectBrief>;
    return { ...DEFAULT_PROJECT_BRIEF, ...b };
  }

  /* ---------------- 制作物 (assets) ---------------- */

  async listAssets(tenantId: string, projectId: string): Promise<ProjectAssetDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.projectAsset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
    );
    return (rows as AssetRow[]).map(toAssetDto);
  }

  async createAsset(tenantId: string, projectId: string, input: CreateAssetInput): Promise<ProjectAssetDto> {
    if (!ASSET_TYPES.includes(input?.type)) {
      throw new AppError(HttpStatus.BAD_REQUEST, '制作物の種別が不正です。', '広告文・LP・チラシ・動画から選択してください。');
    }
    if (!input?.title?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'タイトルが未入力です。', 'タイトルを入力してください。');
    }
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      return tx.projectAsset.create({
        data: {
          tenantId,
          projectId,
          type: input.type,
          title: input.title.trim(),
          content: input.content ?? '',
          url: input.url ?? '',
          note: input.note ?? '',
        },
      });
    });
    return toAssetDto(row as AssetRow);
  }

  async updateAsset(tenantId: string, assetId: string, input: UpdateAssetInput): Promise<ProjectAssetDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const asset = await tx.projectAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      const data: Record<string, unknown> = {};
      if (typeof input.title === 'string' && input.title.trim()) data.title = input.title.trim();
      if (typeof input.content === 'string') data.content = input.content;
      // url は外部LP等の http(s) か空のみ許可。/uploads の内部パスはアップロード処理でのみ設定し、
      // ユーザー入力での偽装(パストラバーサル起点)を防ぐ。
      if (typeof input.url === 'string') {
        const u = input.url.trim();
        if (u === '' || /^https?:\/\//i.test(u)) data.url = u;
        else throw new AppError(HttpStatus.BAD_REQUEST, 'URLの形式が正しくありません。', 'http(s) で始まるURLを入力してください。');
      }
      if (typeof input.note === 'string') data.note = input.note;
      if (input.status && ASSET_STATUSES.includes(input.status)) {
        // 「公開」への遷移は updateAsset では許可しない。公開は publishAsset に一本化する
        // (owner/admin限定・client版拒否・監査記録の3重ガードを updateAsset の
        //  assertEditor(operatorも通る) で回避できてしまうため)。
        if (input.status === 'published') {
          throw new AppError(
            HttpStatus.FORBIDDEN,
            'この操作では公開できません。',
            '公開は「公開する」操作から行ってください（オーナー・管理者のみ）。',
          );
        }
        data.status = input.status;
        data.publishedAt = null;
      }
      return tx.projectAsset.update({ where: { id: assetId }, data });
    });
    return toAssetDto(row as AssetRow);
  }

  /** 業種+ヒアリングから最適なクリエイティブ案を生成する (F-26)。
   *  ANTHROPIC_API_KEY 設定時は実Claude、未設定時は業種×ヒアリングの決定的生成にフォールバック */
  async generateCreatives(tenantId: string, projectId: string, count: number, scope?: string | null): Promise<CreativeGenDto> {
    const project = await this.prisma.withTenant(tenantId, (tx) =>
      tx.project.findUnique({ where: { id: projectId }, include: { client: true } }),
    );
    if (!project || (scope && project.clientId !== scope)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
    }
    const profile = industryProfileFor(project.client.industryCode);
    const brief = this.mergeBrief(project.brief);
    const goal = project.goal as ProjectGoal;
    const n = Math.min(Math.max(count || 4, 1), 8);
    const fallback = () => buildCreativeVariants(profile, brief, goal, n);

    if (this.llm.available) {
      try {
        const variants = await this.generateCreativesLlm(tenantId, profile.code, profile.label, brief, goal, n);
        // 空・件数不足時は決定的生成で補完
        return { mocked: false, industryLabel: profile.label, variants: variants.length ? variants : fallback() };
      } catch {
        // LLM失敗時は決定的生成にフォールバック (可用性優先)
        return { mocked: true, industryLabel: profile.label, variants: fallback() };
      }
    }
    return { mocked: true, industryLabel: profile.label, variants: fallback() };
  }

  /** 実Claudeで業種特化クリエイティブを生成する。ヒアリング・業種ガイダンスを注入 */
  private async generateCreativesLlm(
    tenantId: string,
    industryCode: string,
    industryLabel: string,
    brief: ProjectBrief,
    goal: ProjectGoal,
    count: number,
  ): Promise<CreativeVariant[]> {
    const profile = industryProfileFor(industryCode);
    const briefLines = (Object.entries(brief) as [keyof ProjectBrief, string][])
      .filter(([, v]) => (v ?? '').trim())
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n') || '(ヒアリング未記入)';
    const user = [
      `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.creative}`,
      `<request>業種: ${industryLabel} / 目的: ${goal} / 案数: ${count} / 訴求軸(この順で優先): ${profile.appealAxes.join('、')}</request>`,
      `<brief>\n${briefLines}\n</brief>`,
      `<industry_guidance>\n推奨訴求軸: ${profile.appealAxes.join('、')} / 要注意表現(避ける): ${profile.ngWords.join('、')} / CV呼称: ${profile.cvLabel} / 勘所: ${profile.tip}\n</industry_guidance>`,
    ].join('\n\n');
    const text = await this.llm.completeText({
      tenantId,
      feature: 'creative',
      model: PROMPTS.creative.model,
      system: PROMPTS.creative.system,
      user,
      promptVersion: PROMPTS.creative.version,
    });
    const parsed = CreativeGenResultSchema.safeParse(LlmService.parseJson(text));
    if (!parsed.success) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'クリエイティブ生成の出力検証に失敗しました。', 'もう一度生成してください。');
    }
    return parsed.data.variants.slice(0, count).map(creativeVariantFromLlm);
  }

  /** 生成したクリエイティブ案を制作物(広告文)として登録する (F-26) */
  async adoptCreatives(tenantId: string, projectId: string, input: AdoptCreativeInput): Promise<ProjectAssetDto[]> {
    const variants = (input?.variants ?? []).filter((v) => v?.headline?.trim());
    if (variants.length === 0) {
      throw new AppError(HttpStatus.BAD_REQUEST, '採用する案が選ばれていません。', '1件以上選択してください。');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const out: ProjectAssetDto[] = [];
      for (const v of variants as CreativeVariant[]) {
        const note = [v.bannerConcept ? `バナー構成案: ${v.bannerConcept}` : '', v.rationale ? `狙い: ${v.rationale}` : '']
          .filter(Boolean)
          .join(' / ');
        const row = await tx.projectAsset.create({
          data: {
            tenantId,
            projectId,
            type: 'copy',
            title: v.headline.trim().slice(0, 80),
            content: [v.description, v.primaryText].filter(Boolean).join('\n').trim(),
            note: `[${v.appealAxis}] ${note}`.slice(0, 500),
          },
        });
        out.push(toAssetDto(row as AssetRow));
      }
      return out;
    });
  }

  /** 公開前の徹底チェック (F-35)。配信できない制作物・審査リスク・設定不足を洗い出す */
  async preflight(tenantId: string, projectId: string, scope?: string | null): Promise<PreflightDto> {
    const p = await this.prisma.withTenant(tenantId, (tx) =>
      tx.project.findUnique({ where: { id: projectId }, include: { client: true, adAccounts: true, assets: true } }),
    );
    if (!p || (scope && p.clientId !== scope)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
    }
    const profile = industryProfileFor(p.client.industryCode);
    const settings = this.mergeSettings(p.settings);
    const issues: PreflightIssue[] = [];
    const undeployable: UndeployableAsset[] = [];
    const assets = p.assets as AssetRow[];
    let deployable = 0;

    const platformList = p.adAccounts.map((x) => x.platform as Platform);
    for (const a of assets) {
      const type = a.type as AssetType;
      const text = `${a.title} ${a.content}`.trim();
      let bad: string | null = null;
      // 展開できない条件: 広告文は本文なし / LP・チラシは素材(URL/アップロード)なし
      if (type === 'copy') {
        if (!a.content.trim() && !a.title.trim()) bad = '本文が空です';
      } else if (!a.url.trim()) {
        bad = type === 'lp' ? 'LPのURLがありません' : '画像/URLがありません';
      }
      // この広告構成で反映されない制作物か (媒体・目的に不適合 or 廃止タイプ=旧動画)
      const fitReason = assetTypeFitReason(type, platformList, p.goal as ProjectGoal);
      // 審査で却下されうる表現 (block)
      const blockWords = scanLawDictionary(text).filter((w) => w.severity === 'block');
      const ngHit = profile.ngWords.filter((w) => w && text.includes(w));

      if (bad) {
        undeployable.push({ assetId: a.id, title: a.title, type, reason: bad });
        issues.push({
          level: 'block', scope: 'asset', assetId: a.id, assetTitle: a.title,
          title: `配信できない制作物: ${a.title}`, detail: bad,
          suggestion: '素材を追加するか、この制作物を削除してください。',
        });
      } else if (fitReason) {
        // 広告に反映されない項目 → 削除候補 (公開自体は妨げない=warn)
        undeployable.push({ assetId: a.id, title: a.title, type, reason: fitReason });
        issues.push({
          level: 'warn', scope: 'asset', assetId: a.id, assetTitle: a.title,
          title: `この広告に反映されません: ${a.title}`, detail: fitReason,
          suggestion: 'この配信構成では使われません。不要なら削除してください。',
        });
      } else {
        deployable++;
      }
      if (blockWords.length > 0) {
        issues.push({
          level: 'block', scope: 'asset', assetId: a.id, assetTitle: a.title,
          title: `審査で却下リスク: ${a.title}`, detail: `「${blockWords[0].expression}」など (${blockWords[0].law})`,
          suggestion: blockWords[0].suggestion,
        });
      } else if (ngHit.length > 0) {
        issues.push({
          level: 'warn', scope: 'asset', assetId: a.id, assetTitle: a.title,
          title: `要注意表現: ${a.title}`, detail: `${profile.label}で止まりやすい「${ngHit[0]}」`,
          suggestion: '根拠の明示か表現の緩和を検討してください。',
        });
      }
    }

    // プロジェクト全体
    const budgetSet = (settings.monthlyBudgetTotal ?? 0) > 0 || p.adAccounts.some((x) => x.monthlyBudget != null && Number(x.monthlyBudget) > 0);
    if (assets.length === 0) {
      issues.push({ level: 'block', scope: 'project', title: '制作物がありません', detail: '配信する広告がありません。', suggestion: '制作物を追加してください。' });
    }
    if (!budgetSet) {
      issues.push({ level: 'warn', scope: 'project', title: '予算が未設定', detail: '月予算・媒体別予算が未入力です。', suggestion: '「配信設定」で予算を入力してください。' });
    }
    if (!settings.conversionPoint?.trim()) {
      issues.push({ level: 'warn', scope: 'project', title: 'CV計測地点が未設定', detail: '成果計測が不正確になります。', suggestion: '「配信設定」でCV地点を指定してください。' });
    }
    if (p.adAccounts.length === 0) {
      issues.push({ level: 'warn', scope: 'project', title: '配信先の媒体がありません', detail: '媒体アカウントが紐づいていません。', suggestion: '「掲示」タブで媒体を接続してください。' });
    }

    const order = { block: 0, warn: 1, info: 2 } as const;
    issues.sort((x, y) => order[x.level] - order[y.level]);
    return { ready: !issues.some((i) => i.level === 'block'), totalAssets: assets.length, deployableAssets: deployable, issues, undeployable };
  }

  /** 制作物を削除する (F-35)。展開できない/不要な制作物の削除。アップロード実体も消す */
  async deleteAsset(tenantId: string, assetId: string, userId?: string | null): Promise<{ ok: true }> {
    const asset = await this.prisma.withTenant(tenantId, (tx) => tx.projectAsset.findUnique({ where: { id: assetId } }));
    if (!asset) {
      throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
    }
    // アップロード実体があれば削除 (/uploads/<tenant>/... のみ対象)。
    // url は改ざんされうるため、解決後パスが必ず自テナントのuploads配下に収まることを検証し、
    // ../ によるトラバーサル(他テナント/任意ファイル削除)を防ぐ。
    if (asset.url.startsWith(`/uploads/${tenantId}/`)) {
      const rel = asset.url.slice(`/uploads/${tenantId}/`.length);
      const base = resolve(UPLOAD_DIR, tenantId);
      const target = resolve(base, rel);
      if (target === base || target.startsWith(base + sep)) {
        await unlink(target).catch(() => undefined);
      }
    }
    await this.prisma.withTenant(tenantId, (tx) => tx.projectAsset.delete({ where: { id: assetId } }));
    await this.trail.record({
      tenantId,
      userId,
      action: 'asset_deleted',
      resource: assetId,
      detail: { projectId: asset.projectId, type: asset.type, title: asset.title },
    });
    return { ok: true };
  }

  /** 制作物に画像・動画ファイルを添付する。実体を uploads/ に保存し url を差し替える (F-24) */
  async attachUpload(
    tenantId: string,
    assetId: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<ProjectAssetDto> {
    if (!file) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'ファイルが選択されていません。', '画像または動画を選んでください。');
    }
    const spec = ALLOWED_UPLOAD[file.mimetype];
    if (!spec) {
      throw new AppError(HttpStatus.BAD_REQUEST, '対応していない形式です。', 'PNG / JPG / GIF / WebP / MP4 / MOV / WebM を選んでください。');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'ファイルが大きすぎます。', '50MB以下のファイルを選んでください。');
    }
    // 添付先が自テナントの制作物か確認 (RLS)
    const asset = await this.prisma.withTenant(tenantId, (tx) => tx.projectAsset.findUnique({ where: { id: assetId } }));
    if (!asset) {
      throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
    }
    // uploads/<tenantId>/<assetId>.<ext> に保存 (テナントごとにディレクトリ分離)
    const dir = join(UPLOAD_DIR, tenantId);
    await mkdir(dir, { recursive: true });
    const filename = `${assetId}.${spec.ext}`;
    await writeFile(join(dir, filename), file.buffer);
    const url = `/uploads/${tenantId}/${filename}`;
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.projectAsset.update({ where: { id: assetId }, data: { url } }),
    );
    return toAssetDto(row as AssetRow);
  }

  /** 制作物を公開する。承認者(owner/admin)かつ自社運用版のみ。掲載可否の最終操作 */
  async publishAsset(tenantId: string, assetId: string, user: SessionInfoValue): Promise<ProjectAssetDto> {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '公開の権限がありません。',
        '公開はオーナーまたは管理者のみ実行できます。',
      );
    }
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { edition: true } });
      if (tenant?.edition === 'client') {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'この版では公開操作はできません。',
          '公開は運用担当(自社運用版)側で行われます。',
        );
      }
      const asset = await tx.projectAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      return tx.projectAsset.update({
        where: { id: assetId },
        data: { status: 'published', publishedAt: new Date() },
      });
    });
    await this.trail.record({
      tenantId,
      userId: user.userId,
      action: 'project_published',
      resource: assetId,
      detail: { projectId: row.projectId, type: row.type, title: row.title },
    });
    return toAssetDto(row as AssetRow);
  }

  /** 制作物の改善ポイント (公開後の修正案)。業種相性・法規・種別別チェックで算出 */
  async adviceForAsset(tenantId: string, assetId: string, scope?: string | null): Promise<AssetAdviceDto> {
    const data = await this.prisma.withTenant(tenantId, async (tx) => {
      const asset = await tx.projectAsset.findUnique({
        where: { id: assetId },
        include: { project: { include: { client: true } } },
      });
      if (!asset || (scope && asset.project.clientId !== scope)) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      return asset;
    });
    const industry = data.project.client.industryCode;
    const profile = industryProfileFor(industry);
    const type = data.type as AssetType;
    const items: AssetAdviceItem[] = [];

    if (type === 'copy') {
      const text = `${data.title} ${data.content}`.trim();
      // 法規制チェック (業種NG含む)
      for (const w of scanLawDictionary(text)) {
        items.push({
          title: `表現の見直し: 「${w.expression}」`,
          detail: `${w.law}に触れるおそれ。${w.suggestion}`,
          severity: w.severity === 'block' ? 'warn' : 'tip',
        });
      }
      for (const ng of profile.ngWords) {
        if (text.includes(ng)) {
          items.push({ title: `${profile.label}で要注意の表現: 「${ng}」`, detail: '媒体審査で止まりやすい表現です。根拠明示か緩和を検討。', severity: 'warn' });
        }
      }
      // 文字数
      const units = widthUnits(data.content || data.title);
      if (units > 0 && units < 20) {
        items.push({ title: '情報量を増やす余地', detail: '説明文が短めです。ベネフィットや実績・数字を1つ加えると訴求力が上がります。', severity: 'tip' });
      }
      // 数字・CTA
      if (!/[0-9０-９]/.test(text)) {
        items.push({ title: '具体的な数字を入れる', detail: '「30%OFF」「導入3,000社」など数値があるとクリック率が上がりやすいです。', severity: 'tip' });
      }
      if (!/(無料|今すぐ|こちら|お試し|資料|予約|申込|購入|登録)/.test(text)) {
        items.push({ title: '行動を促す一言 (CTA) を追加', detail: `目的（${profile.cvLabel}）に合わせて「今すぐ${profile.cvLabel}」など次の行動を明示しましょう。`, severity: 'tip' });
      }
      // 業種の推奨訴求
      items.push({ title: '業種で効く訴求を試す', detail: `${profile.label}では ${profile.appealAxes.slice(0, 3).join('・')} が効きやすい傾向。別パターンをA/Bテストしましょう。`, severity: 'good' });
    } else if (type === 'lp') {
      items.push({ title: 'ファーストビューで結論', detail: '最初の画面で「誰の何が解決するか」と申込ボタンが見えるようにしましょう。', severity: 'tip' });
      items.push({ title: 'CTAボタンを複数配置', detail: 'ページ上部・中段・最下部にボタンを置くと離脱前に押されやすくなります。', severity: 'tip' });
      items.push({ title: 'スマホ表示と速度', detail: '画像を軽量化し、スマホで3秒以内に表示されるか確認を。表示が遅いと直帰します。', severity: 'warn' });
      items.push({ title: '入力フォームは最小限', detail: '項目数を減らすほどCVは上がります。不要な項目は削除・任意化を。', severity: 'tip' });
      items.push({ title: 'CV計測タグの設置確認', detail: '申込完了ページに計測タグが入っているか必ず確認。計測欠落は改善の致命傷です。', severity: 'warn' });
      items.push({ title: '信頼要素を追加', detail: '実績数・導入事例・口コミ・保証を載せると安心感が増します。', severity: 'good' });
    } else {
      // flyer
      items.push({ title: '特典・オファーを大きく', detail: '割引や特典を一番目立たせると反応が上がります。', severity: 'tip' });
      items.push({ title: 'QRコード/URLを載せる', detail: '紙から誘導できるQRやURLを入れ、計測用パラメータも付けましょう。', severity: 'warn' });
      items.push({ title: '連絡先と有効期限', detail: '電話・住所・地図・特典の有効期限を明記すると信頼と緊急性が出ます。', severity: 'tip' });
      items.push({ title: '1枚1メッセージ', detail: '情報を詰め込みすぎず、伝えたいことを1つに絞ると伝わります。', severity: 'good' });
    }

    const summary =
      data.status === 'published'
        ? `公開中の${type === 'copy' ? '広告文' : type === 'lp' ? 'LP' : 'チラシ'}です。次の改善で成果をさらに伸ばせます。`
        : '公開前にこのポイントを押さえておくと成果が出やすくなります。';

    return { assetId, type, summary, items };
  }

  private async projectAccountIds(tx: Tx, projectId: string, scope?: string | null): Promise<{ accountIds: string[] }> {
    const p = await tx.project.findUnique({ where: { id: projectId }, include: { adAccounts: { select: { id: true } } } });
    if (!p || (scope && p.clientId !== scope)) {
      throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
    }
    return { accountIds: p.adAccounts.map((a) => a.id) };
  }

  /** 予算の最適配分 (F-20)。キャンペーン別の効率から、非効率→効率へ再配分し CV最大化 */
  async budgetPlan(tenantId: string, projectId: string, scope?: string | null): Promise<BudgetPlanDto> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { accountIds } = await this.projectAccountIds(tx, projectId, scope);
      if (accountIds.length === 0) {
        return { totalMonthly: 0, reallocatable: 0, expectedCvGain: 0, items: [], note: '媒体アカウントがありません。' };
      }
      const grouped = await tx.factAdPerformance.groupBy({
        by: ['campaignId', 'campaignName', 'platform'],
        where: { adAccountId: { in: accountIds }, date: { gte: daysAgo(27), lte: daysAgo(0) } },
        _sum: { cost: true, conversions: true },
      });
      const camps = grouped
        .map((g) => {
          const cost = Number(g._sum.cost ?? 0); // 直近28日の実消化
          const conv = Number(g._sum.conversions ?? 0);
          const monthly = Math.round((cost / 28) * 30);
          return {
            campaignId: g.campaignId,
            campaignName: g.campaignName || g.campaignId,
            platform: g.platform as Platform,
            cost,
            monthly,
            conversions: +conv.toFixed(1),
            cpa: conv > 0 ? Math.round(cost / conv) : null,
          };
        })
        .filter((c) => c.monthly >= 10000); // 極小は対象外

      const totalMonthly = camps.reduce((s, c) => s + c.monthly, 0);
      // 平均CPAは同一基準(28日実績)で算出する — cpaは28日costから出しているのでcostを使う
      const withConv = camps.filter((c) => c.cpa !== null && c.cpa > 0);
      const totalCost = withConv.reduce((s, c) => s + c.cost, 0);
      const totalConv = withConv.reduce((s, c) => s + c.conversions, 0);
      const avgCpa = totalConv > 0 ? totalCost / totalConv : null;

      // ソース(減額): CV0で高消化 or CPAが平均を大きく超過
      const sources: { c: (typeof camps)[number]; cut: number }[] = [];
      const targets: (typeof camps)[number][] = [];
      for (const c of camps) {
        if (c.cpa === null) {
          if (c.monthly >= 30000) sources.push({ c, cut: Math.round(c.monthly * 0.4) });
        } else if (avgCpa && c.cpa > avgCpa * 1.3) {
          sources.push({ c, cut: Math.round(c.monthly * 0.3) });
        } else if (avgCpa && c.cpa > 0 && c.cpa <= avgCpa * 0.85 && c.conversions >= 1) {
          targets.push(c);
        }
      }
      const reallocatable = sources.reduce((s, x) => s + x.cut, 0);
      const weightSum = targets.reduce((s, t) => s + (t.cpa ? 1 / t.cpa : 0), 0);

      const changeById = new Map<string, number>();
      for (const s of sources) changeById.set(s.c.campaignId, -s.cut);
      let cvGained = 0;
      if (weightSum > 0) {
        for (const t of targets) {
          const received = Math.round((reallocatable * (1 / (t.cpa as number))) / weightSum);
          changeById.set(t.campaignId, received);
          cvGained += received / (t.cpa as number);
        }
      }
      // 減額で失うCV (CPA既知のソースのみ)
      let cvLost = 0;
      for (const s of sources) if (s.c.cpa) cvLost += s.cut / s.c.cpa;
      const expectedCvGain = +Math.max(0, cvGained - cvLost).toFixed(1);

      const items: BudgetPlanItemDto[] = camps.map((c) => {
        const chg = changeById.get(c.campaignId) ?? 0;
        const action: BudgetPlanItemDto['action'] = chg > 0 ? 'increase' : chg < 0 ? 'decrease' : 'keep';
        const reason =
          chg < 0
            ? c.cpa === null
              ? `CV0で月${c.monthly.toLocaleString()}円を消化。予算を絞って効率の良い先へ`
              : `CPA ${c.cpa?.toLocaleString()}円が平均(${Math.round(avgCpa ?? 0).toLocaleString()}円)を超過。減らして再配分`
            : chg > 0
              ? `CPA ${c.cpa?.toLocaleString()}円と効率が良い。予算を寄せてCVを伸ばす`
              : '効率は標準的。現状維持';
        return {
          campaignId: c.campaignId, campaignName: c.campaignName, platform: c.platform,
          monthlyCost: c.monthly, conversions: c.conversions, cpa: c.cpa, action, recommendedChange: chg, reason,
        };
      });
      items.sort((a, b) => a.recommendedChange - b.recommendedChange); // 減額→増額

      const note =
        sources.length === 0 || targets.length === 0
          ? '現状はキャンペーン間の効率差が小さく、再配分の余地は限定的です。'
          : `非効率な配信から月 ${reallocatable.toLocaleString()}円を捻出し、効率の良い配信へ寄せることで、同じ予算で CVを約${expectedCvGain}件/月 増やせる見込みです。`;

      return { totalMonthly, reallocatable, expectedCvGain, items, note };
    });
  }

  /** クリエイティブ疲弊検知 (F-20)。直近7日と前7日のCTR/CVR低下から差し替え時期を判定 */
  async creativeFatigue(tenantId: string, projectId: string, scope?: string | null): Promise<FatigueReportDto> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { accountIds } = await this.projectAccountIds(tx, projectId, scope);
      if (accountIds.length === 0) return { items: [], fatiguedCount: 0, watchCount: 0 };
      const agg = (since: Date, until: Date) =>
        tx.factAdPerformance.groupBy({
          by: ['campaignId', 'campaignName', 'platform'],
          where: { adAccountId: { in: accountIds }, date: { gte: since, lte: until } },
          _sum: { impressions: true, clicks: true, conversions: true, cost: true },
        });
      const [recent, prior] = await Promise.all([agg(daysAgo(6), daysAgo(0)), agg(daysAgo(13), daysAgo(7))]);
      const priorMap = new Map(prior.map((p) => [p.campaignId, p]));

      // 1パス目: 指標を計算
      type Raw = {
        campaignId: string; campaignName: string; platform: Platform; impr: number; cost: number; conv: number;
        ctrR: number | null; ctrP: number | null; ctrDelta: number | null; cvrR: number | null; cvrP: number | null;
        cpa: number | null; level: FatigueLevel;
      };
      const raws: Raw[] = [];
      for (const r of recent) {
        const impr = Number(r._sum.impressions ?? 0);
        const clk = Number(r._sum.clicks ?? 0);
        const conv = Number(r._sum.conversions ?? 0);
        const cost = Number(r._sum.cost ?? 0);
        if (impr < 1000) continue; // 露出が小さいものは判定しない
        const p = priorMap.get(r.campaignId);
        const pImpr = Number(p?._sum.impressions ?? 0);
        const pClk = Number(p?._sum.clicks ?? 0);
        const pConv = Number(p?._sum.conversions ?? 0);
        const ctrR = impr > 0 ? (clk / impr) * 100 : null;
        const ctrP = pImpr > 0 ? (pClk / pImpr) * 100 : null;
        const cvrR = clk > 0 ? (conv / clk) * 100 : null;
        const cvrP = pClk > 0 ? (pConv / pClk) * 100 : null;
        const ctrDelta = ctrR !== null && ctrP ? +(((ctrR - ctrP) / ctrP) * 100).toFixed(1) : null;
        const cpa = conv > 0 ? Math.round(cost / conv) : null;

        let level: FatigueLevel = 'ok';
        if (ctrDelta !== null && ctrDelta <= -20) level = 'fatigued';
        else if (ctrDelta !== null && ctrDelta <= -10) level = 'watch';
        if (cvrR !== null && cvrP && cvrR < cvrP * 0.8 && level === 'watch') level = 'fatigued';

        raws.push({ campaignId: r.campaignId, campaignName: r.campaignName || r.campaignId, platform: r.platform as Platform, impr, cost, conv, ctrR, ctrP, ctrDelta, cvrR, cvrP, cpa, level });
      }
      // 平均CPA (勝ち筋・非効率の基準)
      const withConv = raws.filter((r) => r.cpa !== null);
      const totalCost = withConv.reduce((s, r) => s + r.cost, 0);
      const totalConv = withConv.reduce((s, r) => s + r.conv, 0);
      const avgCpa = totalConv > 0 ? totalCost / totalConv : null;

      const items: FatigueItemDto[] = raws.map((r) => {
        // 疲弊×勝ち筋の総合ローテーション判定
        let rotation: RotationAction = 'keep';
        let rotationReason = '反応は安定。現状維持でOK。';
        if (r.level === 'fatigued') {
          rotation = 'refresh';
          rotationReason = 'CTRが大きく低下し疲弊。新しい訴求・ビジュアルに差し替えを。';
        } else if (r.cpa === null && r.cost >= 30000) {
          rotation = 'pause';
          rotationReason = `CV0で月${Math.round((r.cost / 7) * 30).toLocaleString()}円ペースを消化。一旦止めて予算を効率先へ。`;
        } else if (avgCpa && r.cpa !== null && r.cpa > avgCpa * 1.5) {
          rotation = 'pause';
          rotationReason = `CPA ${r.cpa.toLocaleString()}円が平均(${Math.round(avgCpa).toLocaleString()}円)の1.5倍超。止めるか大幅見直しを。`;
        } else if (avgCpa && r.cpa !== null && r.cpa <= avgCpa * 0.85 && r.conv >= 1 && (r.ctrDelta === null || r.ctrDelta > -10)) {
          rotation = 'scale';
          rotationReason = `CPA ${r.cpa.toLocaleString()}円と効率が良く反応も安定。予算を増やして勝ち筋を伸ばす。`;
        } else if (r.level === 'watch') {
          rotationReason = '反応が下がり始め。次の差し替え候補を準備。';
        }
        const recommendation =
          r.level === 'fatigued' ? 'クリエイティブが疲弊しています。新しい訴求・ビジュアルに差し替えましょう。'
            : r.level === 'watch' ? '反応が下がり始めています。次の差し替え候補を準備しておきましょう。'
              : '反応は安定しています。';
        return {
          campaignId: r.campaignId, campaignName: r.campaignName, platform: r.platform,
          impressionsRecent: r.impr,
          ctrRecent: r.ctrR !== null ? +r.ctrR.toFixed(2) : null,
          ctrPrior: r.ctrP !== null ? +r.ctrP.toFixed(2) : null,
          ctrDeltaPct: r.ctrDelta,
          cvrRecent: r.cvrR !== null ? +r.cvrR.toFixed(2) : null,
          cvrPrior: r.cvrP !== null ? +r.cvrP.toFixed(2) : null,
          cpaRecent: r.cpa,
          level: r.level, recommendation, rotation, rotationReason,
        };
      });
      // 並び: 止める→差し替え→増やす→維持
      const rOrder: Record<RotationAction, number> = { pause: 0, refresh: 1, scale: 2, keep: 3 };
      items.sort((a, b) => rOrder[a.rotation] - rOrder[b.rotation]);
      return {
        items,
        fatiguedCount: items.filter((i) => i.level === 'fatigued').length,
        watchCount: items.filter((i) => i.level === 'watch').length,
      };
    });
  }

  async create(tenantId: string, input: CreateProjectInput): Promise<ProjectDto> {
    if (!input?.name?.trim() || !input?.clientId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'プロジェクト名またはクライアントが未指定です。',
        'プロジェクト名とクライアントを選択してください。',
      );
    }
    const goal: ProjectGoal = GOALS.includes(input.goal as ProjectGoal) ? (input.goal as ProjectGoal) : 'conversion';
    await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      const project = await tx.project.create({
        data: { tenantId, clientId: input.clientId, name: input.name.trim(), goal, note: input.note ?? '' },
      });
      if (input.accountIds?.length) {
        await tx.adAccount.updateMany({
          where: { id: { in: input.accountIds }, clientId: input.clientId },
          data: { projectId: project.id },
        });
      }
      return project;
    });
    const all = await this.list(tenantId);
    return all[0];
  }

  async update(tenantId: string, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const data: Record<string, unknown> = {};
      if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
      if (input.goal && GOALS.includes(input.goal)) data.goal = input.goal;
      if (input.status) data.status = input.status;
      if (typeof input.note === 'string') data.note = input.note;
      if (input.settings && typeof input.settings === 'object') {
        // 既存設定に部分更新をマージして保存
        data.settings = { ...this.mergeSettings(project.settings), ...input.settings } as object;
      }
      if (input.brief && typeof input.brief === 'object') {
        data.brief = { ...this.mergeBrief(project.brief), ...input.brief } as object;
      }
      if (Object.keys(data).length) await tx.project.update({ where: { id }, data });

      if (input.accountIds) {
        // 既存の紐付けを解除し、指定アカウントを再割当 (同一クライアント内のみ)
        await tx.adAccount.updateMany({ where: { projectId: id }, data: { projectId: null } });
        if (input.accountIds.length) {
          await tx.adAccount.updateMany({
            where: { id: { in: input.accountIds }, clientId: project.clientId },
            data: { projectId: id },
          });
        }
      }
    });
    const all = await this.list(tenantId);
    const found = all.find((p) => p.id === id);
    if (!found) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '再読み込みしてください。');
    return found;
  }
}
