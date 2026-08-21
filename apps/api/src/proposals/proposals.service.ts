import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateProposalInput, Platform, ProposalDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import type { SessionInfoValue } from '../common/tenant';
import { MediaSyncService } from '../media-connector/sync.service';

const APPROVER_ROLES = new Set(['owner', 'admin']);

function fmtYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
    private readonly media: MediaSyncService,
  ) {}

  /* ---------------- kill switch (tenant.settings.applyEnabled) ---------------- */

  async getApplyEnabled(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    const s = (tenant?.settings ?? {}) as Record<string, unknown>;
    return s.applyEnabled !== false; // 既定は有効
  }

  async setApplyEnabled(tenantId: string, enabled: boolean, user: SessionInfoValue): Promise<boolean> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>), applyEnabled: enabled };
      await tx.tenant.update({ where: { id: tenantId }, data: { settings } });
    });
    await this.trail.record({
      tenantId,
      userId: user.userId,
      action: enabled ? 'apply_enabled' : 'apply_disabled',
    });
    return enabled;
  }

  private assertApprover(user: SessionInfoValue): void {
    if (!APPROVER_ROLES.has(user.role)) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '承認・実行の権限がありません。',
        '承認はオーナーまたは管理者ロールのみ実行できます。承認者に依頼してください。',
      );
    }
  }

  /* ---------------- 作成 ---------------- */

  private async buildSimulation(
    tenantId: string,
    input: CreateProposalInput,
  ): Promise<string> {
    if (input.actionType === 'adjust_budget') {
      const newBudget = Number(input.actionPayload.newMonthlyBudget);
      if (!Number.isFinite(newBudget) || newBudget <= 0) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          '新しい月予算が正しくありません。',
          '正の金額 (円) を入力してください。',
        );
      }
      const acc = await this.prisma.withTenant(tenantId, (tx) =>
        tx.adAccount.findUnique({ where: { id: input.adAccountId } }),
      );
      const cur = acc?.monthlyBudget ? Number(acc.monthlyBudget) : null;
      if (cur) {
        const delta = ((newBudget - cur) / cur) * 100;
        return `月予算 ${fmtYen(cur)} → ${fmtYen(newBudget)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%)。日予算換算で約${fmtYen(newBudget / 30)}/日になります。`;
      }
      return `月予算を ${fmtYen(newBudget)} に設定します。`;
    }
    if (input.actionType === 'adjust_bid') {
      const pct = Number(input.actionPayload.percent);
      if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 50) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          '入札調整率が正しくありません。',
          '-50〜+50% の範囲で入力してください (例: -15)。',
        );
      }
      return `対象キャンペーンの入札を${pct > 0 ? '+' : ''}${pct}%調整します。配信量とCPAの両方に影響します。`;
    }
    if (input.actionType === 'pause_campaign') {
      return `対象キャンペーンの配信を停止します。停止中は費用が発生しません (再開は媒体管理画面から)。`;
    }
    throw new AppError(HttpStatus.BAD_REQUEST, '不明なアクション種別です。', 'アクションを選び直してください。');
  }

  async create(tenantId: string, user: SessionInfoValue, input: CreateProposalInput): Promise<ProposalDto> {
    if (!input?.adAccountId || !input?.title?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '提案の対象アカウントまたはタイトルが未指定です。',
        '対象アカウントと提案内容を確認してください。',
      );
    }
    const simulation = await this.buildSimulation(tenantId, input);
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const acc = await tx.adAccount.findUnique({ where: { id: input.adAccountId } });
      if (!acc) {
        throw new AppError(HttpStatus.NOT_FOUND, '対象アカウントが見つかりません。', 'アカウントを選び直してください。');
      }
      return tx.proposal.create({
        data: {
          tenantId,
          adAccountId: input.adAccountId,
          actionType: input.actionType,
          actionPayload: input.actionPayload as object,
          title: input.title.trim(),
          evidence: input.evidence ?? '',
          risk: input.risk ?? '',
          confidence: input.confidence ?? 'mid',
          simulation,
          sourceAuditId: input.sourceAuditId ?? null,
          sourceRank: input.sourceRank ?? null,
          createdBy: user.userId,
        },
      });
    });
    await this.trail.record({
      tenantId,
      userId: user.userId,
      action: 'proposal_create',
      resource: row.id,
      detail: { actionType: input.actionType },
    });
    return (await this.list(tenantId)).find((p) => p.id === row.id)!;
  }

  /* ---------------- 承認→実行 ---------------- */

  async approveAndExecute(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    if (!(await this.getApplyEnabled(tenantId))) {
      throw new AppError(
        HttpStatus.CONFLICT,
        '自動適用が停止されています (kill switch)。',
        '設定画面で自動適用を有効化してから承認してください。',
      );
    }
    const proposal = await this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id }, include: { adAccount: true } });
      if (!p) throw new AppError(HttpStatus.NOT_FOUND, '提案が見つかりません。', '一覧を再読込してください。');
      if (p.status !== 'pending') {
        throw new AppError(
          HttpStatus.CONFLICT,
          `この提案は既に処理済みです (${p.status})。`,
          '一覧を再読込して最新の状態を確認してください。',
        );
      }
      return tx.proposal.update({
        where: { id },
        data: { status: 'approved', approvedBy: user.userId, approvedAt: new Date() },
        include: { adAccount: true },
      });
    });

    // 実行 (承認済みレコードのみ到達)
    try {
      const payload = proposal.actionPayload as Record<string, unknown>;
      let note = '';
      let rollbackPayload: object | null = null;

      if (proposal.actionType === 'adjust_budget') {
        // ローカル管理値の実適用 (変更前値を保持しロールバック可能)
        const newBudget = Number(payload.newMonthlyBudget);
        const old = proposal.adAccount.monthlyBudget ? Number(proposal.adAccount.monthlyBudget) : null;
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.adAccount.update({ where: { id: proposal.adAccountId }, data: { monthlyBudget: newBudget } }),
        );
        rollbackPayload = { monthlyBudget: old };
        note = `月予算を${old !== null ? `${fmtYen(old)}→` : ''}${fmtYen(newBudget)}に変更しました。`;
      } else {
        // 媒体書込はコネクタ経由 (デモ接続はシミュレート実行)
        const conn = await this.prisma.withTenant(tenantId, (tx) =>
          tx.mediaConnection.findUnique({
            where: { tenantId_platform: { tenantId, platform: proposal.adAccount.platform } },
          }),
        );
        const connector = this.media.resolveConnector(
          proposal.adAccount.platform as Platform,
          (conn?.mode as 'mock' | 'oauth') ?? 'mock',
        );
        const result = await connector.applyChange({
          requiresApproval: true,
          approvalId: proposal.id,
          entity: 'campaign',
          externalId: String(payload.campaignId ?? proposal.adAccount.externalAccountId),
          operation: proposal.actionType === 'adjust_bid' ? 'update_bid' : 'update_status',
          payload,
        });
        note = result.note;
        rollbackPayload = { simulated: result.simulated };
      }

      await this.prisma.withTenant(tenantId, (tx) =>
        tx.proposal.update({
          where: { id },
          data: { status: 'executed', executedAt: new Date(), executionNote: note, rollbackPayload },
        }),
      );
      await this.trail.record({
        tenantId,
        userId: user.userId,
        action: 'proposal_execute',
        resource: id,
        detail: { actionType: proposal.actionType },
      });
    } catch (e) {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.proposal.update({
          where: { id },
          data: { status: 'failed', executionNote: String(e).slice(0, 300) },
        }),
      );
      throw e;
    }
    return (await this.list(tenantId)).find((p) => p.id === id)!;
  }

  async reject(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p || p.status !== 'pending') {
        throw new AppError(HttpStatus.CONFLICT, '却下できるのは承認待ちの提案のみです。', '一覧を再読込してください。');
      }
      await tx.proposal.update({
        where: { id },
        data: { status: 'rejected', approvedBy: user.userId, approvedAt: new Date() },
      });
    });
    await this.trail.record({ tenantId, userId: user.userId, action: 'proposal_reject', resource: id });
    return (await this.list(tenantId)).find((p) => p.id === id)!;
  }

  async rollback(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p || p.status !== 'executed') {
        throw new AppError(HttpStatus.CONFLICT, 'ロールバックできるのは実行済みの提案のみです。', '一覧を再読込してください。');
      }
      const rb = (p.rollbackPayload ?? {}) as Record<string, unknown>;
      if (p.actionType === 'adjust_budget' && 'monthlyBudget' in rb) {
        await tx.adAccount.update({
          where: { id: p.adAccountId },
          data: { monthlyBudget: rb.monthlyBudget === null ? null : Number(rb.monthlyBudget) },
        });
      }
      await tx.proposal.update({
        where: { id },
        data: {
          status: 'rolled_back',
          executionNote: `${p.executionNote} → 変更前の値に戻しました。`,
        },
      });
    });
    await this.trail.record({ tenantId, userId: user.userId, action: 'proposal_rollback', resource: id });
    return (await this.list(tenantId)).find((p) => p.id === id)!;
  }

  /* ---------------- 一覧 ---------------- */

  async list(tenantId: string): Promise<ProposalDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.proposal.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { adAccount: { include: { client: true } } },
      }),
    );
    const order: Record<string, number> = { pending: 0, approved: 1, executed: 2, failed: 3, rolled_back: 4, rejected: 5 };
    return rows
      .map((p) => ({
        id: p.id,
        adAccountId: p.adAccountId,
        accountName: p.adAccount.name,
        clientName: p.adAccount.client.name,
        platform: p.adAccount.platform as Platform,
        actionType: p.actionType as ProposalDto['actionType'],
        actionPayload: (p.actionPayload ?? {}) as Record<string, unknown>,
        title: p.title,
        evidence: p.evidence,
        risk: p.risk,
        confidence: p.confidence as ProposalDto['confidence'],
        simulation: p.simulation,
        status: p.status as ProposalDto['status'],
        executionNote: p.executionNote,
        canRollback:
          p.status === 'executed' &&
          p.actionType === 'adjust_budget' &&
          p.rollbackPayload !== null,
        createdAt: p.createdAt.toISOString(),
        approvedAt: p.approvedAt?.toISOString() ?? null,
        executedAt: p.executedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }
}
