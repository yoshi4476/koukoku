import { HttpStatus, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { UPLOAD_DIR } from '../projects/upload.constants';

/**
 * 画像生成 (F-34)。Google Imagen 4 (Vertex/Gemini API) を呼び出し、制作物に画像を添付する。
 * GEMINI_API_KEY (または GOOGLE_API_KEY) 設定時のみ実生成。原価は llm_calls に feature='image'
 * で記録し、Claude と同じ「AI利用量」画面に合算表示される。枚数×単価で課金される点に注意。
 */

// 生成画像1枚あたりの料金 (USD)。改定時はここを更新 (要 Vertex AI 料金ページ確認)
const IMAGE_PRICE_USD: Record<string, number> = {
  'imagen-4.0-ultra-generate-001': 0.06,
  'imagen-4.0-generate-001': 0.04,
  'imagen-4.0-fast-generate-001': 0.02,
};
const JPY_PER_USD = 150;
const DEFAULT_MODEL = 'imagen-4.0-ultra-generate-001';
const ALLOWED_ASPECT = new Set(['1:1', '9:16', '16:9', '3:4', '4:3']);

export interface ImageGenResult {
  url: string;
  model: string;
  count: number;
  costJpy: number;
}

interface PredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

@Injectable()
export class ImageGenService {
  constructor(private readonly prisma: PrismaService) {}

  private get apiKey(): string | null {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
  }

  get available(): boolean {
    return this.apiKey !== null;
  }

  private priceUsd(model: string): number {
    return IMAGE_PRICE_USD[model] ?? 0.06;
  }

  /**
   * 制作物にAI生成画像を添付する。prompt からImagenで生成し uploads/ に保存、url を差し替える。
   */
  async generateForAsset(
    tenantId: string,
    assetId: string,
    opts: { prompt: string; aspectRatio?: string; model?: string; count?: number },
  ): Promise<ImageGenResult> {
    const key = this.apiKey;
    if (!key) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        '画像生成APIキーが未設定です。',
        '.env に GEMINI_API_KEY (Google Gemini/Vertex) を設定するとImagenで画像生成できます。',
      );
    }
    if (!opts.prompt?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'プロンプトが空です。', '生成する画像の説明を入力してください。');
    }
    const model = opts.model && IMAGE_PRICE_USD[opts.model] ? opts.model : DEFAULT_MODEL;
    const aspectRatio = opts.aspectRatio && ALLOWED_ASPECT.has(opts.aspectRatio) ? opts.aspectRatio : '1:1';
    const count = Math.min(Math.max(opts.count ?? 1, 1), 4);

    // 添付先が自テナントの制作物か確認 (RLS)
    const asset = await this.prisma.withTenant(tenantId, (tx) => tx.projectAsset.findUnique({ where: { id: assetId } }));
    if (!asset) {
      throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
    }

    const started = Date.now();
    const endpoint =
      process.env.IMAGEN_ENDPOINT ??
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          instances: [{ prompt: opts.prompt.trim() }],
          parameters: { sampleCount: count, aspectRatio, personGeneration: 'allow_adult' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      throw new AppError(HttpStatus.BAD_GATEWAY, '画像生成サービスに接続できませんでした。', '時間をおいて再試行してください。');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        `画像生成に失敗しました (HTTP ${res.status})。`,
        detail.includes('SAFETY') || detail.includes('blocked')
          ? '安全性フィルタで拒否された可能性があります。プロンプトを調整してください。'
          : 'プロンプトやAPI設定を確認して再試行してください。',
      );
    }
    const data = (await res.json()) as PredictResponse;
    const preds = (data.predictions ?? []).filter((p) => p.bytesBase64Encoded);
    if (preds.length === 0) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, '画像が生成されませんでした。', 'プロンプトを変えて再試行してください。');
    }

    // 保存 (複数枚生成時は最後の1枚を添付、全枚数を保存)
    const dir = join(UPLOAD_DIR, tenantId);
    await mkdir(dir, { recursive: true });
    let url = '';
    for (let i = 0; i < preds.length; i++) {
      const buf = Buffer.from(preds[i].bytesBase64Encoded as string, 'base64');
      const filename = `${assetId}_imagen_${i}.png`;
      await writeFile(join(dir, filename), buf);
      url = `/uploads/${tenantId}/${filename}`;
    }
    await this.prisma.withTenant(tenantId, (tx) => tx.projectAsset.update({ where: { id: assetId }, data: { url } }));

    // 原価記録 (枚数×単価)。Claudeと同じ llm_calls / AI利用量 に合算
    const costJpy = +(this.priceUsd(model) * preds.length * JPY_PER_USD).toFixed(2);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.llmCall.create({
        data: {
          tenantId,
          feature: 'image',
          model,
          inputTokens: 0,
          outputTokens: preds.length,
          costJpy,
          latencyMs: Date.now() - started,
          promptVersion: 'imagen.v1',
        },
      }),
    );

    return { url, model, count: preds.length, costJpy };
  }
}
