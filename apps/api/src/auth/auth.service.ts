import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Edition, MeDto, MemberRole, SwitchableTenantDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

export interface SessionPayload {
  sub: string; // userId
  tenantId: string;
  role: MemberRole;
  /** 提供先(client)アクセスの場合の限定クライアントID */
  clientScopeId?: string | null;
}

export const SESSION_COOKIE = 'adgrid_session';

function authSecret(): string {
  // 空文字も未設定として扱う (?? だと '' が漏れて jwt.sign が例外→500 になるため || を使う)。
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  // 本番では必ず実値を設定する (未設定/空はfail-closed)。ローカル開発のみデフォルトで継続。
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be set in production');
  }
  return 'adgrid-local-dev-secret-change-me';
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, authSecret(), { expiresIn: '7d' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, authSecret());
    if (typeof decoded !== 'object' || decoded === null) return null;
    const d = decoded as Record<string, unknown>;
    if (typeof d.sub !== 'string' || typeof d.tenantId !== 'string') return null;
    return {
      sub: d.sub,
      tenantId: d.tenantId,
      role: (d.role as MemberRole) ?? 'operator',
      clientScopeId: typeof d.clientScopeId === 'string' ? d.clientScopeId : null,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(input: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
  }): Promise<{ me: MeDto; token: string }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'メールアドレスの形式が正しくありません。',
        'example@company.co.jp の形式で入力してください。',
      );
    }
    if ((input.password ?? '').length < 8) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'パスワードが短すぎます。',
        '8文字以上のパスワードを設定してください。',
      );
    }
    if (!input.name?.trim() || !input.tenantName?.trim()) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'お名前または会社名が未入力です。',
        'すべての項目を入力してください。',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'このメールアドレスは登録済みです。',
        'ログイン画面からサインインするか、別のメールアドレスをお使いください。',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const tenantId = `t_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: input.name.trim() },
    });
    // テナント作成はRLS対象のため、新テナントIDをコンテキストに設定して作成
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: input.tenantName.trim() } });
    });
    await this.prisma.tenantMember.create({
      data: { userId: user.id, tenantId, role: 'owner' },
    });

    const payload: SessionPayload = { sub: user.id, tenantId, role: 'owner' };
    return {
      me: {
        userId: user.id,
        email,
        name: user.name,
        tenantId,
        tenantName: input.tenantName.trim(),
        role: 'owner',
        edition: 'agency',
        clientScopeId: null,
        clientScopeName: null,
        switchableTenants: [
          { id: tenantId, name: input.tenantName.trim(), edition: 'agency', role: 'owner', isChild: false },
        ],
      },
      token: signSession(payload),
    };
  }

  async login(email: string, password: string): Promise<{ me: MeDto; token: string }> {
    const invalid = () =>
      new AppError(
        HttpStatus.UNAUTHORIZED,
        'メールアドレスまたはパスワードが一致しません。',
        '入力内容を確認して再試行してください。パスワードを忘れた場合は管理者に連絡してください。',
      );
    // 注意: tenants はRLS対象のため、ここでは join せず
    // テナントID確定後に withTenant 内で名前を取得する
    const user = await this.prisma.user.findUnique({
      where: { email: (email ?? '').trim().toLowerCase() },
      include: { memberships: true },
    });
    if (!user) throw invalid();
    const ok = await bcrypt.compare(password ?? '', user.passwordHash);
    if (!ok) throw invalid();
    const membership = user.memberships[0];
    if (!membership) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '所属するワークスペースがありません。',
        '招待メールを確認するか、新規登録からワークスペースを作成してください。',
      );
    }
    const scopeId = membership.role === 'client' ? membership.clientId ?? null : null;
    const { tenant, clientScopeName } = await this.prisma.withTenant(membership.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: membership.tenantId } });
      const client = scopeId ? await tx.client.findUnique({ where: { id: scopeId } }) : null;
      return { tenant, clientScopeName: client?.name ?? null };
    });
    const payload: SessionPayload = {
      sub: user.id,
      tenantId: membership.tenantId,
      role: membership.role as MemberRole,
      clientScopeId: scopeId,
    };
    return {
      me: {
        userId: user.id,
        email: user.email,
        name: user.name,
        tenantId: membership.tenantId,
        tenantName: tenant?.name ?? '',
        role: membership.role as MemberRole,
        // 提供先アクセスは常に提供先版(client)として振る舞う
        edition: scopeId ? 'client' : ((tenant?.edition as Edition) ?? 'agency'),
        clientScopeId: scopeId,
        clientScopeName,
        switchableTenants: await this.switchableTenantsOf(user.id),
      },
      token: signSession(payload),
    };
  }

  /** ユーザーが切り替えられるテナント一覧 (所属する全テナント)。各テナント文脈で名前を取得 */
  private async switchableTenantsOf(userId: string): Promise<SwitchableTenantDto[]> {
    const memberships = await this.prisma.tenantMember.findMany({ where: { userId } });
    const out: SwitchableTenantDto[] = [];
    for (const m of memberships) {
      const t = await this.prisma.withTenant(m.tenantId, (tx) => tx.tenant.findUnique({ where: { id: m.tenantId } }));
      if (t) {
        out.push({
          id: t.id,
          name: t.name,
          edition: (t.edition as Edition) ?? 'agency',
          role: m.role as MemberRole,
          isChild: t.parentTenantId != null,
        });
      }
    }
    // 親(自社)を先頭に、子(提供先)を後ろに
    out.sort((a, b) => Number(a.isChild) - Number(b.isChild));
    return out;
  }

  /** アクティブテナントの切替。ユーザーが所属していれば新テナントでセッション再発行 */
  async switchTenant(session: SessionPayload, tenantId: string): Promise<{ me: MeDto; token: string }> {
    const membership = await this.prisma.tenantMember.findFirst({ where: { userId: session.sub, tenantId } });
    if (!membership) {
      throw new AppError(HttpStatus.FORBIDDEN, 'このテナントへの権限がありません。', '所属するテナントを選んでください。');
    }
    const scopeId = membership.role === 'client' ? membership.clientId ?? null : null;
    const payload: SessionPayload = { sub: session.sub, tenantId, role: membership.role as MemberRole, clientScopeId: scopeId };
    return { me: await this.me(payload), token: signSession(payload) };
  }

  async me(session: SessionPayload): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      include: { memberships: { where: { tenantId: session.tenantId } } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'セッションが無効です。',
        'もう一度ログインしてください。',
      );
    }
    const scopeId = membership.role === 'client' ? membership.clientId ?? null : null;
    const { tenant, clientScopeName } = await this.prisma.withTenant(session.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: session.tenantId } });
      const client = scopeId ? await tx.client.findUnique({ where: { id: scopeId } }) : null;
      return { tenant, clientScopeName: client?.name ?? null };
    });
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      tenantId: membership.tenantId,
      tenantName: tenant?.name ?? '',
      role: membership.role as MemberRole,
      edition: scopeId ? 'client' : ((tenant?.edition as Edition) ?? 'agency'),
      clientScopeId: scopeId,
      clientScopeName,
      switchableTenants: await this.switchableTenantsOf(user.id),
    };
  }

  /** 版の切替 (owner専用)。1システムで自社運用版⇄提供先版をデモ/運用切替する */
  async setEdition(session: SessionPayload, edition: Edition): Promise<MeDto> {
    if (session.role !== 'owner') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '版の切替はオーナーのみ可能です。',
        'オーナー権限のアカウントで操作してください。',
      );
    }
    await this.prisma.withTenant(session.tenantId, (tx) =>
      tx.tenant.update({ where: { id: session.tenantId }, data: { edition } }),
    );
    return this.me(session);
  }
}
