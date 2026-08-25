import { Injectable, Logger } from '@nestjs/common';
import type { PacingSweepDto, PacingSweepItem } from '@adgrid/shared';
import { buildPacingProposals } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionInfoValue } from '../common/tenant';
import { ProposalsService } from '../proposals/proposals.service';
import { PacingService } from './pacing.service';

/**
 * ペーシング→予算提案の自動反映ループ (F-51)。
 * 予算逸脱アカウントを検出し、承認キューに adjust_budget 提案を下書きする。
 * 実行は必ず人手承認を挟む(=安全なループの締め)。同一アカウントに保留中の提案があれば重複を避ける。
 */
@Injectable()
export class PacingProposalService {
  private readonly logger = new Logger(PacingProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pacing: PacingService,
    private readonly proposals: ProposalsService,
  ) {}

  async sweep(tenantId: string, user: SessionInfoValue): Promise<PacingSweepDto> {
    const list = await this.pacing.compute(tenantId);
    const drafts = buildPacingProposals(list);

    // 既に保留中の予算提案があるアカウントは重複回避でスキップ
    const pending = await this.prisma.withTenant(tenantId, (tx) =>
      tx.proposal.findMany({
        where: { actionType: 'adjust_budget', status: 'pending', adAccountId: { in: drafts.map((d) => d.adAccountId) } },
        select: { adAccountId: true },
      }),
    );
    const hasPending = new Set(pending.map((p) => p.adAccountId));

    const items: PacingSweepItem[] = [];
    let created = 0;
    let skipped = 0;
    for (const d of drafts) {
      if (hasPending.has(d.adAccountId)) {
        skipped++;
        items.push({ adAccountId: d.adAccountId, accountName: d.accountName, title: d.title, newMonthlyBudget: d.newMonthlyBudget, direction: d.direction, created: false });
        continue;
      }
      await this.proposals.create(tenantId, user, {
        adAccountId: d.adAccountId,
        actionType: 'adjust_budget',
        actionPayload: { newMonthlyBudget: d.newMonthlyBudget },
        title: d.title,
        evidence: d.evidence,
        risk: d.risk,
        confidence: d.confidence,
      });
      created++;
      items.push({ adAccountId: d.adAccountId, accountName: d.accountName, title: d.title, newMonthlyBudget: d.newMonthlyBudget, direction: d.direction, created: true });
    }
    return { scanned: drafts.length, created, skipped, items };
  }
}
