import { HttpStatus, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

export type LlmFeature = 'audit' | 'report' | 'copy' | 'creative' | 'format_detect' | 'brief_extract' | 'keyword_plan';

// Claude API 料金 (USD/100万トークン, 2026-08時点)。変更時はここを更新
const PRICE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const JPY_PER_USD = 150;
// プロンプトキャッシュの料金倍率: 書き込み(初回)=入力の1.25倍 / 読み込み(ヒット)=入力の0.10倍
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

@Injectable()
export class LlmService {
  private readonly client: Anthropic | null;

  constructor(private readonly prisma: PrismaService) {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }

  /** APIキー未設定時はモックモード (ルールベース実装で代替) */
  get available(): boolean {
    return this.client !== null;
  }

  /**
   * LLM呼出 + llm_calls への原価記録 (F-09)。
   * 全AI機能はこのメソッドを経由する (直接のAPI呼出は禁止)。
   */
  async completeText(opts: {
    tenantId: string;
    feature: LlmFeature;
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    promptVersion: string;
  }): Promise<string> {
    if (!this.client) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ANTHROPIC_API_KEY が未設定です。',
        '.env に ANTHROPIC_API_KEY を設定するか、モックモードの結果をご利用ください。',
      );
    }
    const started = Date.now();
    const res = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      // システムプロンプトは機能ごとに静的なため、prompt caching で入力課金を圧縮する。
      // 最小長に満たない場合はAPIがキャッシュを無視するだけで無害 (診断など長いプロンプトで効く)。
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.user }],
    });
    const latencyMs = Date.now() - started;

    const u = res.usage as LlmUsage;
    // 使用量表示は「実際に処理した入力トークン合計」(通常+キャッシュ書込+キャッシュ読込)
    const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const outputTokens = u.output_tokens;
    const costJpy = LlmService.costJpyFor(opts.model, u);

    await this.prisma.withTenant(opts.tenantId, (tx) =>
      tx.llmCall.create({
        data: {
          tenantId: opts.tenantId,
          feature: opts.feature,
          model: opts.model,
          inputTokens,
          outputTokens,
          costJpy,
          latencyMs,
          promptVersion: opts.promptVersion,
        },
      }),
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (res.stop_reason === 'refusal') {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AIが応答を生成できませんでした。',
        '入力内容を変更して再試行してください。',
      );
    }
    return text;
  }

  /**
   * 原価(円)を算出する。prompt caching の料金体系を反映:
   * 通常入力=1.0倍 / キャッシュ書込=1.25倍 / キャッシュ読込=0.10倍 / 出力=出力単価。
   */
  static costJpyFor(model: string, usage: LlmUsage): number {
    const price = PRICE_USD_PER_MTOK[model] ?? { input: 5, output: 25 };
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const usd =
      (usage.input_tokens * price.input +
        cacheWrite * price.input * CACHE_WRITE_MULT +
        cacheRead * price.input * CACHE_READ_MULT +
        usage.output_tokens * price.output) /
      1_000_000;
    return +(usd * JPY_PER_USD).toFixed(2);
  }

  /** LLM出力からJSON部分を抽出してパースする (コードフェンス・前置き対策) */
  static parseJson(text: string): unknown {
    const stripped = text.replace(/```(?:json)?/g, '');
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI出力の形式が不正でした (JSONが見つかりません)。',
        '再試行してください。続く場合はプロンプトレジストリの版を確認してください。',
      );
    }
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI出力のJSONパースに失敗しました。',
        '再試行してください。続く場合はプロンプトレジストリの版を確認してください。',
      );
    }
  }
}
