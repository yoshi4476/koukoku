import { HttpStatus, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

export type LlmFeature = 'audit' | 'report' | 'copy' | 'creative' | 'format_detect';

// Claude API 料金 (USD/100万トークン, 2026-08時点)。変更時はここを更新
const PRICE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const JPY_PER_USD = 150;

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
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    });
    const latencyMs = Date.now() - started;

    const price = PRICE_USD_PER_MTOK[opts.model] ?? { input: 5, output: 25 };
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    const costJpy =
      ((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * JPY_PER_USD;

    await this.prisma.withTenant(opts.tenantId, (tx) =>
      tx.llmCall.create({
        data: {
          tenantId: opts.tenantId,
          feature: opts.feature,
          model: opts.model,
          inputTokens,
          outputTokens,
          costJpy: +costJpy.toFixed(2),
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
