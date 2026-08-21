import { Injectable } from '@nestjs/common';
import type { CalibrationDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';

const CATEGORY_LABEL: Record<string, string> = {
  measurement: '計測',
  budget: '予算',
  structure: '構造',
  bidding: '入札',
  creative: 'クリエイティブ',
  other: 'その他',
};

// 較正を効かせるための最小サンプル (このカテゴリの採用/見送りの合計)
const MIN_SAMPLE = 10;

/**
 * 確信度較正 (A-4)。診断指摘の採用/見送り実績をカテゴリ別に集計し、
 * 「実際に採用されるカテゴリ」の確信度を上げ、見送られがちなカテゴリを下げる。
 * calibration_stats はテナント横断集計 (匿名) で、adopt/dismiss 時に更新される。
 */
@Injectable()
export class CalibrationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 指摘のステータス変更時に採用/見送りカウントを差分更新する (from を取り消し、to を加算) */
  async record(category: string, from: string, to: string): Promise<void> {
    const add: { adopted: number; dismissed: number } = { adopted: 0, dismissed: 0 };
    if (to === 'adopted') add.adopted += 1;
    if (to === 'dismissed') add.dismissed += 1;
    if (from === 'adopted') add.adopted -= 1;
    if (from === 'dismissed') add.dismissed -= 1;
    if (add.adopted === 0 && add.dismissed === 0) return;

    await this.prisma.calibrationStat.upsert({
      where: { category },
      create: { category, adopted: Math.max(0, add.adopted), dismissed: Math.max(0, add.dismissed) },
      update: {
        ...(add.adopted !== 0 ? { adopted: { increment: add.adopted } } : {}),
        ...(add.dismissed !== 0 ? { dismissed: { increment: add.dismissed } } : {}),
      },
    });
  }

  /** カテゴリ別の較正係数 (診断時に確信度へ適用)。採用率>60%で+、<25%で- */
  async factors(): Promise<Map<string, 'boost' | 'penalty' | 'neutral'>> {
    const stats = await this.prisma.calibrationStat.findMany();
    const map = new Map<string, 'boost' | 'penalty' | 'neutral'>();
    for (const s of stats) {
      const total = s.adopted + s.dismissed;
      if (total < MIN_SAMPLE) continue;
      const rate = s.adopted / total;
      map.set(s.category, rate > 0.6 ? 'boost' : rate < 0.25 ? 'penalty' : 'neutral');
    }
    return map;
  }

  async summary(): Promise<CalibrationDto[]> {
    const stats = await this.prisma.calibrationStat.findMany();
    const byCat = new Map(stats.map((s) => [s.category, s]));
    return Object.keys(CATEGORY_LABEL).map((category) => {
      const s = byCat.get(category);
      const adopted = s?.adopted ?? 0;
      const dismissed = s?.dismissed ?? 0;
      const total = adopted + dismissed;
      const adoptionRate = total > 0 ? +(adopted / total).toFixed(2) : null;
      let effect: CalibrationDto['effect'] = 'insufficient';
      if (total >= MIN_SAMPLE && adoptionRate !== null) {
        effect = adoptionRate > 0.6 ? 'boost' : adoptionRate < 0.25 ? 'penalty' : 'neutral';
      }
      return { category, categoryLabel: CATEGORY_LABEL[category], adopted, dismissed, adoptionRate, effect };
    });
  }
}
