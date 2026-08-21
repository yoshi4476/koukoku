import { HttpStatus, Injectable } from '@nestjs/common';
import { CopyResultSchema } from '@adgrid/shared';
import type { CopyCandidate, CopyResult, CopyRunDto, KnowledgeAssetDto, Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LlmService } from './llm.service';
import { OUTPUT_SCHEMAS, PROMPTS } from './prompt-registry';
import { scanLawDictionary } from './law-dictionary';
import { limitsFor, widthUnits } from './copy-limits';

export interface CopyRunInput {
  clientId: string;
  platform: Platform;
  productInfo: string;
  appealAxes: string[];
  count: number;
}

@Injectable()
export class CopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly trail: TrailService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /* テンプレート生成 (モックモード)。1案=1訴求を厳守。勝ちパターンの訴求軸を優先 (B-1) */
  private templateCandidates(input: CopyRunInput, winningPatterns: KnowledgeAssetDto[] = []): CopyCandidate[] {
    const productName = input.productInfo.split(/\r?\n/)[0]?.slice(0, 18) || '本サービス';
    const templates: Record<string, { h: string; d: string }> = {
      便益: {
        h: `${productName}で成果を実感`,
        d: `${productName}なら、いまの業務のままで成果につながります。まずは資料で詳細をご確認ください。`,
      },
      損失回避: {
        h: `その課題、放置していませんか`,
        d: `対応が遅れるほど損失は積み上がります。${productName}が現状の見直しをお手伝いします。`,
      },
      社会的証明: {
        h: `多くの企業が${productName}を選択`,
        d: `導入企業の事例を公開中です。同じ課題を持つ企業の活用方法をご覧ください。`,
      },
      権威: {
        h: `専門家と作った${productName}`,
        d: `専門家の知見をもとに設計しました。詳しい監修情報は公式サイトでご確認いただけます。`,
      },
      '緊急性・限定': {
        h: `導入検討は今がおすすめ`,
        d: `期末に向けた導入スケジュールのご相談を受付中です。日程はお早めにご確認ください。`,
      },
      '価格・オファー': {
        h: `まずは無料で${productName}を試す`,
        d: `無料プランからはじめられます。費用の詳細は料金ページをご覧ください。`,
      },
      新規性: {
        h: `新しい${productName}、登場`,
        d: `従来のやり方を見直す新機能を追加しました。変更点は公式サイトでご確認ください。`,
      },
      簡便性: {
        h: `設定は数分で完了`,
        d: `専門知識は不要です。${productName}は登録後すぐに使いはじめられます。`,
      },
    };
    // 指定軸 > 勝ちパターンの軸 > 全軸 の優先順で並べる
    const winAxes = winningPatterns.map((p) => p.appealAxis).filter((a) => a in templates);
    const axes = input.appealAxes.length > 0
      ? input.appealAxes
      : [...new Set([...winAxes, ...Object.keys(templates)])];
    const out: CopyCandidate[] = [];
    for (let i = 0; i < input.count; i++) {
      const axis = axes[i % axes.length];
      const t = templates[axis] ?? templates['便益'];
      out.push({ appeal_axis: axis, headline: t.h, description: t.d, law_issues: [] });
    }
    return out;
  }

  /** 2段チェックの1段目: 辞書スキャン (モック/実モード共通で必ず実行) + 入力原文もチェック */
  private applyDictionary(candidates: CopyCandidate[], productInfo: string): CopyCandidate[] {
    return candidates.map((c) => {
      const dictIssues = scanLawDictionary(`${c.headline} ${c.description}`);
      const merged = [...c.law_issues];
      for (const issue of dictIssues) {
        const dup = merged.some((m) => m.expression === issue.expression && m.law === issue.law);
        if (!dup) merged.push(issue);
      }
      void productInfo;
      return { ...c, law_issues: merged };
    });
  }

  private lengthChecks(candidates: CopyCandidate[], platform: Platform) {
    const limits = limitsFor(platform);
    return candidates.map((c, index) => ({
      index,
      headlineOk: widthUnits(c.headline) <= limits.headlineUnits,
      descriptionOk: widthUnits(c.description) <= limits.descriptionUnits,
    }));
  }

  async run(tenantId: string, input: CopyRunInput): Promise<CopyRunDto> {
    if (!input.productInfo?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '商材情報が入力されていません。',
        '商材名と特徴を1行以上入力してから「広告文を生成」をクリックしてください。',
      );
    }
    const count = Math.min(Math.max(input.count || 3, 1), 10);

    // B-1: クライアント業種の勝ちパターンを取得しプロンプトへ反映
    const client = await this.prisma.withTenant(tenantId, (tx) =>
      tx.client.findUnique({ where: { id: input.clientId } }),
    );
    const winningPatterns = client
      ? await this.knowledge.topFor(tenantId, client.industryCode, 3)
      : [];

    let candidates: CopyCandidate[];
    let mocked = false;
    if (this.llm.available) {
      const dictHits = scanLawDictionary(input.productInfo);
      const limits = limitsFor(input.platform);
      const patternsBlock = winningPatterns.length
        ? winningPatterns
            .map((p) => `- ${p.appealAxis}: ${p.creativeSummary} (勝率${Math.round(p.winRate * 100)}%${p.liftPct ? `・リフト+${p.liftPct}%` : ''})`)
            .join('\n')
        : '(この業種の勝ちパターンはまだ蓄積されていません)';
      const user = [
        `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.copy}`,
        `<request>媒体: ${input.platform} / 訴求軸: ${input.appealAxes.join('、') || '自動選定'} / 案数: ${count} / 目標長: 見出し${limits.headlineUnits}ユニット・説明文${limits.descriptionUnits}ユニット以内 (全角=2)</request>`,
        `<product_info>\n${input.productInfo}\n</product_info>`,
        `<winning_patterns>\n同業種で成果が実証された勝ちパターン。参考にしつつ商材に合わせること:\n${patternsBlock}\n</winning_patterns>`,
        `<law_dictionary_hits>\n${JSON.stringify(dictHits)}\n</law_dictionary_hits>`,
      ].join('\n\n');
      const text = await this.llm.completeText({
        tenantId,
        feature: 'copy',
        model: PROMPTS.copy.model,
        system: PROMPTS.copy.system,
        user,
        promptVersion: PROMPTS.copy.version,
      });
      const parsed = CopyResultSchema.safeParse(LlmService.parseJson(text));
      if (!parsed.success) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          '広告文出力がスキーマ検証に失敗しました。',
          'もう一度生成してください。',
        );
      }
      candidates = parsed.data.candidates.slice(0, count);
    } else {
      candidates = this.templateCandidates({ ...input, count }, winningPatterns);
      mocked = true;
    }

    candidates = this.applyDictionary(candidates, input.productInfo);
    const result: CopyResult = { candidates };
    const lengthChecks = this.lengthChecks(candidates, input.platform);

    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.copyJob.create({
        data: {
          tenantId,
          clientId: input.clientId,
          platform: input.platform,
          promptVersion: mocked ? 'template.v1' : PROMPTS.copy.version,
          model: mocked ? 'template' : PROMPTS.copy.model,
          mocked,
          input: {
            productInfo: input.productInfo,
            appealAxes: input.appealAxes,
            count,
          },
          result: result as object,
          lengthChecks: lengthChecks as object[],
        },
      }),
    );
    await this.trail.record({
      tenantId,
      action: 'copy_run',
      resource: input.clientId,
      detail: { copyJobId: row.id, mocked, platform: input.platform, count },
    });
    return this.toDto(row);
  }

  private toDto(row: {
    id: string;
    clientId: string;
    platform: string;
    createdAt: Date;
    promptVersion: string;
    mocked: boolean;
    input: unknown;
    result: unknown;
    lengthChecks: unknown;
  }): CopyRunDto {
    return {
      id: row.id,
      clientId: row.clientId,
      platform: row.platform as Platform,
      createdAt: row.createdAt.toISOString(),
      promptVersion: row.promptVersion,
      mocked: row.mocked,
      input: row.input as CopyRunDto['input'],
      result: row.result as CopyRunDto['result'],
      lengthChecks: (row.lengthChecks ?? []) as CopyRunDto['lengthChecks'],
    };
  }

  async list(tenantId: string, clientId?: string): Promise<CopyRunDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.copyJob.findMany({
        where: clientId ? { clientId } : {},
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map((r) => this.toDto(r));
  }
}
