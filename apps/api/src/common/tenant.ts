import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { MemberRole } from '@adgrid/shared';
import { AppError } from './errors';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';

/** セッションの提供先スコープ(限定クライアントID)。通常ユーザーは null */
export function clientScopeOf(req: Request): string | null {
  const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
  if (!token) return null;
  const session = verifySession(token);
  return session?.clientScopeId ?? null;
}

/** 提供先アクセス(client)のときの限定クライアントID。それ以外は null */
export const ClientScope = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null =>
  clientScopeOf(ctx.switchToHttp().getRequest<Request>()),
);

/**
 * `x-tenant-id` ヘッダ / DEV_TENANT_ID フォールバックを許可するか。
 * これは無認証でテナントを指定できてしまう開発専用の抜け道のため、
 * 本番 (NODE_ENV=production) では ALLOW_TENANT_HEADER=true を明示しない限り無効。
 * 開発環境では従来どおり既定で有効 (ALLOW_TENANT_HEADER=false で明示無効化も可)。
 */
function tenantHeaderAllowed(): boolean {
  if (process.env.ALLOW_TENANT_HEADER === 'true') return true;
  if (process.env.ALLOW_TENANT_HEADER === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * テナント解決の優先順位:
 * 1. セッションクッキー (JWT) — 通常のログインユーザー
 * 2. `x-tenant-id` ヘッダ / DEV_TENANT_ID — 開発ツール・cURL用フォールバック (本番は既定で無効)
 */
export function resolveTenantId(req: Request): string | null {
  const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
  if (token) {
    const session = verifySession(token);
    if (session) return session.tenantId;
  }
  if (tenantHeaderAllowed()) {
    const header = req.headers['x-tenant-id'];
    if (typeof header === 'string' && header) return header;
    if (process.env.DEV_TENANT_ID) return process.env.DEV_TENANT_ID;
  }
  return null;
}

export interface SessionInfoValue {
  userId: string | null;
  role: MemberRole;
  clientScopeId: string | null;
}

/**
 * セッションのユーザーID・ロール。
 * 有効なセッションが無い場合は最小権限 (viewer) を返す (fail-safe)。
 * 承認等の特権操作は必ず有効なログインを要求する。
 * 開発ツールで特権が必要な場合のみ ALLOW_DEV_OWNER=true で owner に昇格 (本番では設定しない)。
 */
export const SessionInfo = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionInfoValue => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
  if (token) {
    const session = verifySession(token);
    if (session) return { userId: session.sub, role: session.role, clientScopeId: session.clientScopeId ?? null };
  }
  // 本番では dev owner 昇格を無効化 (誤設定による特権付与を防ぐ)
  if (process.env.ALLOW_DEV_OWNER === 'true' && process.env.NODE_ENV !== 'production') {
    return { userId: null, role: 'owner', clientScopeId: null };
  }
  return { userId: null, role: 'viewer', clientScopeId: null };
});

export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw new AppError(
      HttpStatus.UNAUTHORIZED,
      'ログインしていません。',
      'ログイン画面からサインインしてください。',
    );
  }
  return tenantId;
});
