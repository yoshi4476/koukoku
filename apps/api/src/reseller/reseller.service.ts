import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { ChildTenantDto, CreateChildTenantInput, Edition } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import type { SessionInfoValue } from '../common/tenant';

/**
 * リセラー: 提供先テナント発行 (F-23)。
 * 自社(親テナント)が、他社ごとに独立したテナントを発行する。子テナントは
 * parentTenantId で親に紐づき、データは RLS で完全分離される。自社ユーザーは
 * 子テナントの admin としても登録され、テナント切替で管理できる。
 */
@Injectable()
export class ResellerService {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(user: SessionInfoValue) {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new AppError(HttpStatus.FORBIDDEN, 'テナント発行の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
  }

  async list(parentTenantId: string): Promise<ChildTenantDto[]> {
    // 親コンテキストでは RLS により子テナント(parent_tenant_id=親)も可視
    const children = await this.prisma.withTenant(parentTenantId, (tx) =>
      tx.tenant.findMany({ where: { parentTenantId }, orderBy: { createdAt: 'desc' } }),
    );
    const out: ChildTenantDto[] = [];
    for (const c of children) {
      const owner = await this.prisma.tenantMember.findFirst({
        where: { tenantId: c.id, role: 'owner' },
        include: { user: true },
      });
      out.push({
        id: c.id,
        name: c.name,
        edition: (c.edition as Edition) ?? 'client',
        status: c.status,
        adminEmail: owner?.user.email ?? '',
        createdAt: c.createdAt.toISOString(),
      });
    }
    return out;
  }

  async create(parentTenantId: string, actor: SessionInfoValue, input: CreateChildTenantInput): Promise<ChildTenantDto> {
    this.assertManager(actor);
    // 提供先テナント(それ自体が子)からの再発行は不可
    const self = await this.prisma.withTenant(parentTenantId, (tx) => tx.tenant.findUnique({ where: { id: parentTenantId } }));
    if (self?.parentTenantId) {
      throw new AppError(HttpStatus.FORBIDDEN, 'このテナントからは発行できません。', '提供先テナントの発行は自社(親)アカウントで行ってください。');
    }
    const email = (input?.adminEmail ?? '').trim().toLowerCase();
    if (!input?.companyName?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, '会社名が未入力です。', '提供先の会社名を入力してください。');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'メールアドレスの形式が正しくありません。', 'example@company.co.jp の形式で入力してください。');
    }
    if ((input?.adminPassword ?? '').length < 8) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'パスワードが短すぎます。', '8文字以上を設定してください。');
    }
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new AppError(HttpStatus.CONFLICT, 'このメールアドレスは登録済みです。', '別のメールアドレスをお使いください。');
    }

    const childId = `t_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    // 子テナント作成 (自身の文脈で WITH CHECK を満たす)
    await this.prisma.withTenant(childId, (tx) =>
      tx.tenant.create({
        data: { id: childId, name: input.companyName.trim(), edition: 'client', parentTenantId },
      }),
    );
    // 提供先の管理者ユーザー (このテナントのオーナー)
    const adminUser = await this.prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(input.adminPassword, 10), name: input.adminName?.trim() || `${input.companyName.trim()} 管理者` },
    });
    await this.prisma.tenantMember.create({ data: { userId: adminUser.id, tenantId: childId, role: 'owner' } });
    // 自社(発行者)も子テナントの admin として登録 → テナント切替で管理可能
    if (actor.userId) {
      await this.prisma.tenantMember.create({ data: { userId: actor.userId, tenantId: childId, role: 'admin' } });
    }

    return {
      id: childId, name: input.companyName.trim(), edition: 'client', status: 'active',
      adminEmail: email, createdAt: new Date().toISOString(),
    };
  }
}
