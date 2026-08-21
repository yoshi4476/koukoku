import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';

/**
 * 開発中の暫定テナント解決: `x-tenant-id` ヘッダ → DEV_TENANT_ID。
 * 認証 (F-07) 実装時にセッション由来へ置き換える。
 */
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const header = req.headers['x-tenant-id'];
  const tenantId = (typeof header === 'string' && header) || process.env.DEV_TENANT_ID || '';
  if (!tenantId) {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'テナントが指定されていません。',
      'リクエストヘッダ x-tenant-id を設定するか、環境変数 DEV_TENANT_ID を設定してください。',
    );
  }
  return tenantId;
});
