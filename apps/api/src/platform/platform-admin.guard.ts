import { CanActivate, ExecutionContext, HttpStatus, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';
import { isPlatformAdminEmail } from './platform-admin';

export { isPlatformAdminEmail, platformAdminEmails } from './platform-admin';

/** リクエストのセッションからユーザーIDを取り出す (無効なら null) */
function userIdOf(req: Request): string | null {
  const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
  if (!token) return null;
  return verifySession(token)?.sub ?? null;
}

export interface PlatformAdminValue {
  userId: string;
  email: string;
}

/**
 * システム管理APIのガード。
 * JWTのクレームではなく **毎回DBのメールアドレスを環境変数と突き合わせる**。
 * 発行済みトークンに管理者フラグを埋めないので、環境変数から外せば即座に無効化できる。
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { platformAdmin?: PlatformAdminValue }>();
    const denied = () =>
      new AppError(
        HttpStatus.FORBIDDEN,
        'システム管理者の権限がありません。',
        'このページはサービス運営者専用です。',
      );

    const userId = userIdOf(req);
    if (!userId) throw denied();

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!isPlatformAdminEmail(user?.email)) throw denied();

    req.platformAdmin = { userId, email: user!.email };
    return true;
  }
}

/** ガードが確認済みのシステム管理者 */
export const PlatformAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformAdminValue => {
  const req = ctx.switchToHttp().getRequest<Request & { platformAdmin?: PlatformAdminValue }>();
  if (!req.platformAdmin) {
    throw new AppError(HttpStatus.FORBIDDEN, 'システム管理者の権限がありません。', 'このページはサービス運営者専用です。');
  }
  return req.platformAdmin;
});
