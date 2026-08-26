import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';

/** ログアウトだけは常に通す (クッキーを消せないと画面から抜けられなくなるため) */
const ALWAYS_ALLOWED = new Set(['/auth/logout']);

/** 状態の参照はリクエストごとに発生するため短時間キャッシュする */
const TTL_MS = 30_000;

/**
 * セッションが今も有効かをリクエストごとに確認する (F-61 / F-62)。
 *
 * JWTは発行後7日間そのまま通るため、次の2つが署名検証だけでは防げない:
 *  1. テナントを停止しても、ログイン中の利用者はそのまま使い続けられる
 *  2. パスワードを再設定しても、乗っ取り側の既存セッションが生き残る
 *
 * どちらも「止めたのに止まらない」ため、状態をDBで確認する。
 * 30秒キャッシュし、停止/再開・パスワード再設定の時点で該当キャッシュを落とすので
 * 反映は即時。
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private static tenantCache = new Map<string, { active: boolean; at: number }>();
  private static userCache = new Map<string, { tokenVersion: number | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** テナントの停止/再開の直後に呼ぶ */
  static invalidateTenant(tenantId: string) {
    SessionGuard.tenantCache.delete(tenantId);
  }

  /** パスワード再設定の直後に呼ぶ */
  static invalidateUser(userId: string) {
    SessionGuard.userCache.delete(userId);
  }

  private async isTenantActive(tenantId: string): Promise<boolean> {
    const hit = SessionGuard.tenantCache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.active;
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
    );
    // 行が見つからない場合は判定できないため通す (認証・RLS側で弾かれる)
    const active = tenant == null || tenant.status === 'active';
    SessionGuard.tenantCache.set(tenantId, { active, at: Date.now() });
    return active;
  }

  /** 現在有効なセッション世代。ユーザーが見つからない場合は判定しない (null) */
  private async currentTokenVersion(userId: string): Promise<number | null> {
    const hit = SessionGuard.userCache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.tokenVersion;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    const tokenVersion = user ? user.tokenVersion : null;
    SessionGuard.userCache.set(userId, { tokenVersion, at: Date.now() });
    return tokenVersion;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (ALWAYS_ALLOWED.has(req.path)) return true;

    // セッションが無い経路 (ログイン・共有ポータル・CV受信など) はここでは扱わない
    const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
    if (!token) return true;
    const session = verifySession(token);
    if (!session) return true;

    if (!(await this.isTenantActive(session.tenantId))) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'このワークスペースは現在ご利用いただけません。',
        'ご契約状況について、発行元の担当者にお問い合わせください。',
      );
    }

    // 世代が変わっていたら無効。時刻ではなく世代で見るので「同一秒」の曖昧さが無く、
    // 再設定の直後に取り直したセッションは新しい世代を持つため巻き込まれない
    const current = await this.currentTokenVersion(session.sub);
    if (current != null && (session.tv ?? 0) !== current) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'パスワードが変更されたため、ログインし直してください。',
        '新しいパスワードでログインしてください。',
      );
    }
    return true;
  }
}
