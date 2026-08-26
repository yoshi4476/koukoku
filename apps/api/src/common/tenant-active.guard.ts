import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';

/** ログアウトだけは停止中でも通す (クッキーを消せないと画面から抜けられなくなるため) */
const ALWAYS_ALLOWED = new Set(['/auth/logout']);

/** 状態の参照はリクエストごとに発生するため短時間キャッシュする */
const TTL_MS = 30_000;

/**
 * 停止中テナントのアクセスを遮断する (F-61)。
 *
 * ログイン時だけの確認では不十分だった。セッションJWTの有効期限は7日あるため、
 * 停止した時点で既にログインしているユーザーはそのまま使い続けられてしまう。
 * 「利用を停止する」が実効性を持つよう、リクエストごとに状態を確認する。
 *
 * 停止/再開の操作時は invalidate() でキャッシュを落とすため、反映は即時。
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  private static cache = new Map<string, { active: boolean; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** 停止/再開の直後に呼ぶ。次のリクエストからDBを見に行く */
  static invalidate(tenantId: string) {
    TenantActiveGuard.cache.delete(tenantId);
  }

  private async isActive(tenantId: string): Promise<boolean> {
    const hit = TenantActiveGuard.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.active;
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
    );
    // 行が見つからない場合は判定できないため通す (認証・RLS側で弾かれる)
    const active = tenant == null || tenant.status === 'active';
    TenantActiveGuard.cache.set(tenantId, { active, at: Date.now() });
    return active;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (ALWAYS_ALLOWED.has(req.path)) return true;

    // セッションが無い経路 (ログイン・共有ポータル・CV受信など) はここでは扱わない
    const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
    if (!token) return true;
    const session = verifySession(token);
    if (!session) return true;

    if (!(await this.isActive(session.tenantId))) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'このワークスペースは現在ご利用いただけません。',
        'ご契約状況について、発行元の担当者にお問い合わせください。',
      );
    }
    return true;
  }
}
