import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateFeedbackInput, FeedbackDto } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import type { SessionInfoValue } from '../common/tenant';

type FeedbackRow = {
  id: string; clientId: string; authorName: string; projectId: string | null;
  message: string; status: string; createdAt: Date;
};

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private async clientNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const clients = await tx.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(clients.map((c) => [c.id, c.name]));
  }

  private toDto(r: FeedbackRow, names: Map<string, string>): FeedbackDto {
    return {
      id: r.id, clientId: r.clientId, clientName: names.get(r.clientId) ?? '', authorName: r.authorName,
      projectId: r.projectId, message: r.message, status: r.status as FeedbackDto['status'],
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** 提供先(client)ユーザーがフィードバックを送る。scope=対象クライアント */
  async create(tenantId: string, scope: string | null, user: SessionInfoValue, input: CreateFeedbackInput): Promise<FeedbackDto> {
    if (!scope) {
      throw new AppError(HttpStatus.FORBIDDEN, 'フィードバックは提供先アカウントから送信してください。', '運用側は不要です。');
    }
    if (!input?.message?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'メッセージが空です。', '内容を入力してください。');
    }
    const author = user.userId
      ? (await this.prisma.user.findUnique({ where: { id: user.userId } }))?.name ?? ''
      : '';
    return this.prisma.withTenant(tenantId, async (tx) => {
      // projectId は自分(scope)のクライアントのプロジェクトに限定する (他クライアント混入を防止)
      let projectId: string | null = null;
      if (input.projectId) {
        const p = await tx.project.findUnique({ where: { id: input.projectId }, select: { clientId: true } });
        projectId = p && p.clientId === scope ? input.projectId : null;
      }
      const row = await tx.feedback.create({
        data: {
          tenantId, clientId: scope, userId: user.userId, authorName: author,
          projectId, message: input.message.trim(),
        },
      });
      const names = await this.clientNames(tx, [scope]);
      return this.toDto(row as FeedbackRow, names);
    });
  }

  /** 自社(運用)が受け取ったフィードバックを一覧 */
  async list(tenantId: string): Promise<FeedbackDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = (await tx.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })) as FeedbackRow[];
      const names = await this.clientNames(tx, [...new Set(rows.map((r) => r.clientId))]);
      return rows.map((r) => this.toDto(r, names));
    });
  }

  async resolve(tenantId: string, id: string): Promise<FeedbackDto> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const f = await tx.feedback.findUnique({ where: { id } });
      if (!f) throw new AppError(HttpStatus.NOT_FOUND, 'フィードバックが見つかりません。', '再読み込みしてください。');
      const row = (await tx.feedback.update({ where: { id }, data: { status: 'resolved' } })) as FeedbackRow;
      const names = await this.clientNames(tx, [row.clientId]);
      return this.toDto(row, names);
    });
  }
}
