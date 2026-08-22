import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { ClientAccessDto, CreateClientAccessInput } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import type { SessionInfoValue } from '../common/tenant';

/**
 * 提供先アクセス発行 (F-22)。自社(運用)が、あるクライアント(他社)専用の
 * ログインを発行する。発行されたユーザーは role=client でそのクライアントの
 * データのみを閲覧できる。
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(user: SessionInfoValue) {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new AppError(HttpStatus.FORBIDDEN, 'アクセス発行の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
  }

  async list(tenantId: string, clientId: string): Promise<ClientAccessDto[]> {
    const members = await this.prisma.tenantMember.findMany({
      where: { tenantId, role: 'client', clientId },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      clientId: m.clientId ?? clientId,
      createdAt: m.user.createdAt.toISOString(),
    }));
  }

  async create(
    tenantId: string,
    clientId: string,
    input: CreateClientAccessInput,
    actor: SessionInfoValue,
  ): Promise<ClientAccessDto> {
    this.assertManager(actor);
    const email = (input?.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'メールアドレスの形式が正しくありません。', 'example@company.co.jp の形式で入力してください。');
    }
    if ((input?.password ?? '').length < 8) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'パスワードが短すぎます。', '8文字以上を設定してください。');
    }
    // クライアントの実在をテナント文脈で確認
    const client = await this.prisma.withTenant(tenantId, (tx) => tx.client.findUnique({ where: { id: clientId } }));
    if (!client) {
      throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
    }
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new AppError(HttpStatus.CONFLICT, 'このメールアドレスは登録済みです。', '別のメールアドレスをお使いください。');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: input.name?.trim() || `${client.name} 担当者` },
    });
    await this.prisma.tenantMember.create({
      data: { userId: user.id, tenantId, role: 'client', clientId },
    });
    return { userId: user.id, email: user.email, name: user.name, clientId, createdAt: user.createdAt.toISOString() };
  }

  async revoke(tenantId: string, userId: string, actor: SessionInfoValue): Promise<{ ok: true }> {
    this.assertManager(actor);
    const member = await this.prisma.tenantMember.findFirst({ where: { tenantId, userId, role: 'client' } });
    if (!member) {
      throw new AppError(HttpStatus.NOT_FOUND, '対象のアクセスが見つかりません。', '一覧を再読み込みしてください。');
    }
    await this.prisma.tenantMember.delete({ where: { id: member.id } });
    // このユーザーが他テナントに属していなければユーザーごと削除
    const remaining = await this.prisma.tenantMember.count({ where: { userId } });
    if (remaining === 0) await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }
}
