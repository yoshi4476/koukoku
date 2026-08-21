import { HttpStatus, Injectable } from '@nestjs/common';
import { isApprover } from '@adgrid/shared';
import type { CreateProposalInput, Platform, ProposalDto } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { fmtYen } from '../common/format';
import { readSettings, patchSettings } from '../common/tenant-settings';
import { TrailService } from '../common/trail.service';
import type { SessionInfoValue } from '../common/tenant';
import { MediaSyncService } from '../media-connector/sync.service';

type ProposalRow = {
  id: string;
  adAccountId: string;
  actionType: string;
  actionPayload: unknown;
  title: string;
  evidence: string;
  risk: string;
  confidence: string;
  simulation: string;
  status: string;
  executionNote: string;
  rollbackPayload: unknown;
  createdAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  adAccount: { name: string; platform: string; client: { name: string } };
};

const PROPOSAL_INCLUDE = { adAccount: { include: { client: true } } } as const;

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
      tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    );
    return readSettings(tenant?.settings).applyEnabled !== false; // 既定は有効
  }

  async setApplyEnabled(tenantId: string, enabled: boolean, user: SessionInfoValue): Promise<boolean> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, (tx) => patchSettings(tx, tenantId, { applyEnabled: enabled }));
    await this.trail.record({
      tenantId,
      userId: user.userId,
      action: enabled ? 'apply_enabled' : 'apply_disabled',
    });
    return enabled;
  }

  private assertApprover(user: SessionInfoValue): void {
    if (!isApprover(user.role)) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '承認・実行の権限がありません。',
        '承認はオーナーまたは管理者ロールのみ実行できます。承認者に依頼してください。',
      );
    }
  }

  /* ---------------- 作成 ---------------- */

  /** 入力を検証し、実績アカウントを踏まえたシミュレーション文言を生成する (純関数) */
  private buildSimulation(input: CreateProposalInput, currentBudget: number | null): string {
    if (input.actionType === 'adjust_budget') {
      const newBudget = Number(input.actionPayload.newMonthlyBudget);
      if (!Number.isFinite(newBudget) || newBudget <= 0) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          '新しい月予算が正しくありません。',
          '正の金額 (円) を入力してください。',
        );
      }
      if (currentBudget) {
        const delta = ((newBudget - currentBudget) / currentBudget) * 100;
        return `月予算 ${fmtYen(currentBudget)} → ${fmtYen(newBudget)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%)。日予算換算で約${fmtYen(newBudget / 30)}/日になります。`;
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
    // 提案は承認キューに直接載りワンクリック実行の起点になるため、作成も承認者権限に限定する
    this.assertApprover(user);
    if (!input?.adAccountId || !input?.title?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '提案の対象アカウントまたはタイトルが未指定です。',
        '対象アカウントと提案内容を確認してください。',
      );
    }
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const acc = await tx.adAccount.findUnique({ where: { id: input.adAccountId } });
      if (!acc) {
        throw new AppError(HttpStatus.NOT_FOUND, '対象アカウントが見つかりません。', 'アカウントを選び直してください。');
      }
      const simulation = this.buildSimulation(input, acc.monthlyBudget ? Number(acc.monthlyBudget) : null);
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
        include: PROPOSAL_INCLUDE,
      });
    });
    await this.trail.record({
      tenantId,
      userId: user.userId,
      action: 'proposal_create',
      resource: row.id,
      detail: { actionType: input.actionType },
    });
    return this.toDto(row as ProposalRow);
  }

  /* ---------------- 承認→実行 ---------------- */

  async approveAndExecute(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);

    // 承認をアトミックに確定: kill switch確認・pending→approved を1トランザクションで。
    // updateMany(where status=pending) にすることで、同時承認の二重通過を防ぐ (count=0で敗者を検出)。
    const proposal = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      if (readSettings(tenant?.settings).applyEnabled === false) {
        throw new AppError(
          HttpStatus.CONFLICT,
          '自動適用が停止されています (kill switch)。',
          '設定画面で自動適用を有効化してから承認してください。',
        );
      }
      const claimed = await tx.proposal.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'approved', approvedBy: user.userId, approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        const existing = await tx.proposal.findUnique({ where: { id } });
        if (!existing) throw new AppError(HttpStatus.NOT_FOUND, '提案が見つかりません。', '一覧を再読込してください。');
        throw new AppError(
          HttpStatus.CONFLICT,
          `この提案は既に処理済みです (${existing.status})。`,
          '一覧を再読込して最新の状態を確認してください。',
        );
      }
      return tx.proposal.findUnique({ where: { id }, include: { adAccount: true } });
    });
    if (!proposal) throw new AppError(HttpStatus.NOT_FOUND, '提案が見つかりません。', '一覧を再読込してください。');

    // 実行 (承認を確定できたリクエストのみ到達)
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
        // campaignId 未指定 ('' 含む) はアカウント単位のフォールバックにする (?? は '' を通すため使わない)
        const campaignId = String(payload.campaignId ?? '').trim();
        const result = await connector.applyChange({
          requiresApproval: true,
          approvalId: proposal.id,
          entity: 'campaign',
          externalId: campaignId || proposal.adAccount.externalAccountId,
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
      // 実行失敗は承認待ちに戻し、再試行 or 却下を可能にする (approved のまま袋小路にしない)
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.proposal.update({
          where: { id },
          data: {
            status: 'failed',
            executionNote: (e instanceof AppError ? e.message : String(e)).slice(0, 300),
          },
        }),
      );
      throw e;
    }
    return this.getOne(tenantId, id);
  }

  /** failed 提案を承認待ちに戻す (再試行導線) */
  async requeue(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const claimed = await tx.proposal.updateMany({
        where: { id, status: 'failed' },
        data: { status: 'pending', approvedBy: null, approvedAt: null, executionNote: '' },
      });
      if (claimed.count === 0) {
        throw new AppError(HttpStatus.CONFLICT, '再試行できるのは失敗した提案のみです。', '一覧を再読込してください。');
      }
    });
    await this.trail.record({ tenantId, userId: user.userId, action: 'proposal_requeue', resource: id });
    return this.getOne(tenantId, id);
  }

  async reject(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const claimed = await tx.proposal.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'rejected', approvedBy: user.userId, approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppError(HttpStatus.CONFLICT, '却下できるのは承認待ちの提案のみです。', '一覧を再読込してください。');
      }
    });
    await this.trail.record({ tenantId, userId: user.userId, action: 'proposal_reject', resource: id });
    return this.getOne(tenantId, id);
  }

  async rollback(tenantId: string, user: SessionInfoValue, id: string): Promise<ProposalDto> {
    this.assertApprover(user);
    await this.prisma.withTenant(tenantId, async (tx) => {
      // executed→rolled_back をアトミックに確保してから復元 (二重ロールバック防止)
      const claimed = await tx.proposal.updateMany({
        where: { id, status: 'executed' },
        data: { status: 'rolled_back' },
      });
      if (claimed.count === 0) {
        throw new AppError(HttpStatus.CONFLICT, 'ロールバックできるのは実行済みの提案のみです。', '一覧を再読込してください。');
      }
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p) return;
      const rb = (p.rollbackPayload ?? {}) as Record<string, unknown>;
      if (p.actionType === 'adjust_budget' && 'monthlyBudget' in rb) {
        await tx.adAccount.update({
          where: { id: p.adAccountId },
          data: { monthlyBudget: rb.monthlyBudget === null ? null : Number(rb.monthlyBudget) },
        });
      }
      await tx.proposal.update({
        where: { id },
        data: { executionNote: `${p.executionNote} → 変更前の値に戻しました。` },
      });
    });
    await this.trail.record({ tenantId, userId: user.userId, action: 'proposal_rollback', resource: id });
    return this.getOne(tenantId, id);
  }

  /* ---------------- 取得 ---------------- */

  private toDto(p: ProposalRow): ProposalDto {
    return {
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
      canRollback: p.status === 'executed' && p.actionType === 'adjust_budget' && p.rollbackPayload !== null,
      createdAt: p.createdAt.toISOString(),
      approvedAt: p.approvedAt?.toISOString() ?? null,
      executedAt: p.executedAt?.toISOString() ?? null,
    };
  }

  private async getOne(tenantId: string, id: string): Promise<ProposalDto> {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.proposal.findUnique({ where: { id }, include: PROPOSAL_INCLUDE }),
    );
    if (!row) throw new AppError(HttpStatus.NOT_FOUND, '提案が見つかりません。', '一覧を再読込してください。');
    return this.toDto(row as ProposalRow);
  }

  async list(tenantId: string): Promise<ProposalDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.proposal.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: PROPOSAL_INCLUDE,
      }),
    );
    const order: Record<string, number> = { pending: 0, approved: 1, executed: 2, failed: 3, rolled_back: 4, rejected: 5 };
    return rows
      .map((p) => this.toDto(p as ProposalRow))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }
}
