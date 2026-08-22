import { Injectable } from '@nestjs/common';
import { benchmarkFor } from '@adgrid/shared';
import type { InsightDigestDto, InsightItemDto } from '@adgrid/shared';
import { ProjectsService } from '../projects/projects.service';

/**
 * 週次AIインサイト (F-21)。全プロジェクト横断で「今週の要点とやるべきこと」を
 * 優先度順に自動生成する。運用者が最短で動けるダイジェスト。
 */
@Injectable()
export class InsightsService {
  constructor(private readonly projects: ProjectsService) {}

  async digest(tenantId: string): Promise<InsightDigestDto> {
    const list = await this.projects.list(tenantId);
    const items: InsightItemDto[] = [];

    for (const p of list) {
      const href = `/projects/${p.id}`;
      // 1) アラート = 最優先
      if (p.alertCount > 0) {
        items.push({
          severity: 'critical',
          title: `「${p.name}」にアラート${p.alertCount}件`,
          detail: '配信の異常や不備が出ています。まず確認して対処しましょう。',
          projectId: p.id, projectName: p.name, href,
        });
      }
      // 2) 相場比でCPAが高い = 改善機会
      const bm = benchmarkFor(p.industryCode);
      if (p.cpa7d && p.cpa7d > bm.cpa * 1.3) {
        const over = Math.round(((p.cpa7d - bm.cpa) / bm.cpa) * 100);
        items.push({
          severity: 'opportunity',
          title: `「${p.name}」のCPAが相場を${over}%超過`,
          detail: `CPA ${p.cpa7d.toLocaleString()}円 (${bm.label}相場 ${bm.cpa.toLocaleString()}円)。予算配分の見直しやキーワード最適化で改善余地大。`,
          projectId: p.id, projectName: p.name, href,
        });
      }
      // 3) 未対応の改善提案
      if (p.openFindings > 0) {
        items.push({
          severity: 'opportunity',
          title: `「${p.name}」に未対応の改善提案${p.openFindings}件`,
          detail: 'AI診断の指摘が残っています。優先度の高いものから対応しましょう。',
          projectId: p.id, projectName: p.name, href,
        });
      }
      // 4) レポート未作成/古い
      const stale = !p.lastReportAt || Date.now() - new Date(p.lastReportAt).getTime() > 8 * 24 * 3600 * 1000;
      if (stale && p.cost7d > 0) {
        items.push({
          severity: 'info',
          title: `「${p.name}」のレポートが未作成/古い`,
          detail: 'クライアント向けの最新レポートを生成しておきましょう。',
          projectId: p.id, projectName: p.name, href,
        });
      }
    }

    const order = { critical: 0, opportunity: 1, info: 2 } as const;
    items.sort((a, b) => order[a.severity] - order[b.severity]);
    const top = items.slice(0, 8);

    const crit = items.filter((i) => i.severity === 'critical').length;
    const opp = items.filter((i) => i.severity === 'opportunity').length;
    const headline =
      items.length === 0
        ? '今週は大きな問題も見当たりません。好調を維持しましょう。'
        : `今週の要点: 至急対応 ${crit}件・改善機会 ${opp}件。まず上から着手しましょう。`;

    return { headline, items: top };
  }
}
