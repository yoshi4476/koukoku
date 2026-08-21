import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';

/**
 * テナント解決の優先順位:
 * 1. セッションクッキー (JWT) — 通常のログインユーザー
 * 2. `x-tenant-id` ヘッダ / DEV_TENANT_ID — 開発ツール・cURL用フォールバック
 * 本番デプロイ時は 2 を無効化する (ALLOW_TENANT_HEADER=false)。
 */
export function resolveTenantId(req: Request): string | null {
  const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
  if (token) {
    const session = verifySession(token);
    if (session) return session.tenantId;
  }
  if (process.env.ALLOW_TENANT_HEADER !== 'false') {
    const header = req.headers['x-tenant-id'];
    if (typeof header === 'string' && header) return header;
    if (process.env.DEV_TENANT_ID) return process.env.DEV_TENANT_ID;
  }
  return null;
}

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
