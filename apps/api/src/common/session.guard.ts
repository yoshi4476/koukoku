import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE, verifySession } from '../auth/auth.service';

/**
 * セッションを作り直す/捨てる入口は必ず通す。
 *
 * ここを塞ぐと詰む: 端末Aにログイン中のまま端末Bでパスワードを再設定すると、
 * 端末Aは古いCookieを持ったままになる。ログイン要求にもそのCookieが付くため、
 * 除外しないと「ログインしようとすると古いセッションを理由に弾かれる」状態になり、
 * Cookieを手で消すまで二度とログインできない (実測で確認)。
 */
const ALWAYS_ALLOWED = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/logout',
  '/auth/forgot',
  '/auth/reset',
]);

/**
 * テナント停止の遮断を適用しない経路 (セッション世代のチェックは適用する)。
 *
 * - /platform/*: システム管理者の権限はテナントではなくメールで決まる。
 *   自テナントを停止した運営者が管理画面ごと締め出されるのを防ぐ
 * - /auth/tenant: テナント切替。停止された子テナントに切替中の親管理者が
 *   自社(親)へ戻る唯一の経路のため、塞ぐと詰む (切替先の停止チェックは切替処理側で行う)
 */
function tenantCheckExempt(path: string): boolean {
  return path.startsWith('/platform/') || path === '/auth/tenant';
}

/** 状態の参照はリクエストごとに発生するため短時間キャッシュする */
const TTL_MS = 30_000;

/** キャッシュの上限。超えたら期限切れを掃除し、それでも溢れる場合は全捨てする */
const MAX_CACHE = 5_000;

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

  /**
   * 際限なく増えないようにする。利用者が増えるほどキーが増え続けるため、
   * 上限に達したら期限切れを掃除し、それでも収まらなければ捨てて作り直す
   * (キャッシュなので失っても正しさには影響しない)。
   */
  private static prune(cache: Map<string, { at: number }>) {
    if (cache.size < MAX_CACHE) return;
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.at >= TTL_MS) cache.delete(k);
    }
    if (cache.size >= MAX_CACHE) cache.clear();
  }

  private async isTenantActive(tenantId: string): Promise<boolean> {
    const hit = SessionGuard.tenantCache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.active;
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
    );
    // 行が見つからない場合は判定できないため通す (認証・RLS側で弾かれる)
    const active = tenant == null || tenant.status === 'active';
    SessionGuard.prune(SessionGuard.tenantCache);
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
    SessionGuard.prune(SessionGuard.userCache);
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

    if (!tenantCheckExempt(req.path) && !(await this.isTenantActive(session.tenantId))) {
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
