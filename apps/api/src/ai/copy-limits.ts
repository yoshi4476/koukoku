import type { Platform } from '@adgrid/shared';

/**
 * 媒体別文字数制約 (半角換算ユニット: 全角=2、半角=1)。
 * 代表値のみ。実装時に各媒体の最新仕様で検証し更新すること (AIロジック設計 §③)。
 */
export interface CopyLimits {
  headlineUnits: number;
  descriptionUnits: number;
}

const DEFAULT_LIMITS: CopyLimits = { headlineUnits: 30, descriptionUnits: 90 };

const LIMITS: Partial<Record<Platform, CopyLimits>> = {
  google_ads: { headlineUnits: 30, descriptionUnits: 90 },
  yahoo_search: { headlineUnits: 30, descriptionUnits: 90 },
  meta: { headlineUnits: 40, descriptionUnits: 250 },
};

export function limitsFor(platform: Platform): CopyLimits {
  return LIMITS[platform] ?? DEFAULT_LIMITS;
}

/** 半角換算ユニット数 (ASCII・半角カナ=1、その他=2) */
export function widthUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isHalf = (code >= 0x20 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f);
    units += isHalf ? 1 : 2;
  }
  return units;
}
