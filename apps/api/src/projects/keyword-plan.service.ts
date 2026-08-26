import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { IntentTier, KeywordPlanDto, PlannedKeyword, ProjectBrief, ProjectSettings } from '@adgrid/shared';
import { DEFAULT_PROJECT_BRIEF, DEFAULT_PROJECT_SETTINGS, buildKeywordPlan, industryProfileFor, safeNegatives } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { LlmService } from '../ai/llm.service';
import { OUTPUT_SCHEMAS, PROMPTS } from '../ai/prompt-registry';

const TIERS: IntentTier[] = ['now', 'compare', 'explore'];

/**
 * 検索キーワードの自動設計 (F-57)。
 * 広告効率(CPA)はキーワード選定で大きく決まるため、検索意図の強い語から層別に設計し、
 * 無駄クリックを生む語は除外キーワードとして返す。
 * 実Claude接続時はヒアリングを踏まえて生成し、未接続時は決定的ロジックで代替する。
 */
@Injectable()
export class KeywordPlanService {
  private readonly logger = new Logger(KeywordPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async plan(tenantId: string, projectId: string): Promise<KeywordPlanDto> {
    const project = await this.prisma.withTenant(tenantId, (tx) =>
      tx.project.findUnique({ where: { id: projectId }, include: { client: true } }),
    );
    if (!project) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');

    const brief = { ...DEFAULT_PROJECT_BRIEF, ...((project.brief ?? {}) as Partial<ProjectBrief>) } as ProjectBrief;
    const settings = { ...DEFAULT_PROJECT_SETTINGS, ...((project.settings ?? {}) as Partial<ProjectSettings>) } as ProjectSettings;
    const profile = industryProfileFor(project.client.industryCode);
    const area = [brief.area, settings.regions].filter(Boolean).join(' ');

    const fallback = buildKeywordPlan({
      industryLabel: profile.label,
      industryCode: profile.code,
      product: brief.product,
      business: brief.business,
      usp: brief.usp,
      area,
    });

    if (!this.llm.available) return fallback;

    try {
      const user = [
        `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.keywordPlan}`,
        `<brief>\n${JSON.stringify({
          business: brief.business, product: brief.product, usp: brief.usp,
          targetPersona: brief.targetPersona, painPoint: brief.painPoint, offer: brief.offer, area,
        }, null, 1)}\n</brief>`,
        `<industry_guidance>\n業種: ${profile.label} / CV呼称: ${profile.cvLabel} / 訴求軸: ${profile.appealAxes.join(', ')} / 勘所: ${profile.tip}\n</industry_guidance>`,
      ].join('\n\n');

      const raw = await this.llm.completeText({
        tenantId,
        feature: 'keyword_plan',
        model: PROMPTS.keywordPlan.model,
        system: PROMPTS.keywordPlan.system,
        user,
        maxTokens: 8000,
        promptVersion: PROMPTS.keywordPlan.version,
      });
      const parsed = LlmService.parseJson(raw) as { keywords?: unknown[]; negatives?: unknown[]; note?: unknown };

      const keywords: PlannedKeyword[] = [];
      for (const k of parsed.keywords ?? []) {
        const o = k as Record<string, unknown>;
        const text = typeof o.text === 'string' ? o.text.trim() : '';
        if (!text || text.length > 30) continue;
        if (keywords.some((x) => x.text === text)) continue;
        const tier = TIERS.includes(o.tier as IntentTier) ? (o.tier as IntentTier) : 'compare';
        keywords.push({ text, tier, reason: typeof o.reason === 'string' ? o.reason.slice(0, 120) : '' });
      }
      const negatives = [...new Set(
        (parsed.negatives ?? [])
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter((n) => n && n.length <= 30),
      )];

      // 生成が薄すぎる場合は決定的ロジックで補う (入稿できない事態を防ぐ)
      if (keywords.length < 8) {
        this.logger.warn(`keyword plan too small (${keywords.length}); merging fallback`);
        for (const f of fallback.keywords) {
          if (keywords.length >= 40) break;
          if (!keywords.some((x) => x.text === f.text)) keywords.push(f);
        }
      }
      const finalKeywords = keywords.slice(0, 60);
      // 自分の配信キーワードを塞ぐ除外語は落とす (例: オファーが「無料相談」なのに「無料」を除外)
      const finalNegatives = safeNegatives(
        negatives.length >= 5 ? negatives : fallback.negatives,
        finalKeywords.map((k) => k.text),
      );
      return {
        keywords: finalKeywords,
        negatives: finalNegatives.slice(0, 40),
        note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim().slice(0, 300) : fallback.note,
        mocked: false,
      };
    } catch (e) {
      this.logger.warn(`keyword plan LLM failed, using deterministic plan: ${(e as Error).message}`);
      return fallback;
    }
  }

  /** 生成したキーワードと除外キーワードを配信設定に保存する */
  async apply(tenantId: string, projectId: string, plan: KeywordPlanDto, includeExplore = false): Promise<{ keywordCount: number; negativeCount: number }> {
    const keywords = plan.keywords.filter((k) => includeExplore || k.tier !== 'explore').map((k) => k.text);
    const project = await this.prisma.withTenant(tenantId, (tx) => tx.project.findUnique({ where: { id: projectId } }));
    if (!project) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
    const settings = { ...DEFAULT_PROJECT_SETTINGS, ...((project.settings ?? {}) as Partial<ProjectSettings>) } as ProjectSettings;

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.project.update({
        where: { id: projectId },
        data: {
          settings: {
            ...settings,
            keywords: keywords.join('\n'),
            exclusions: plan.negatives.join('、'),
          } as object,
        },
      }),
    );
    return { keywordCount: keywords.length, negativeCount: plan.negatives.length };
  }
}
