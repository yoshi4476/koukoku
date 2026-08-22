import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from './errors';
import { clientScopeOf } from './tenant';

/**
 * 提供先アクセス(client)の deny-by-default ガード (F-22)。
 * client スコープのセッションは、明示的に許可した「自分のクライアントの閲覧」系
 * エンドポイントとフィードバック送信以外はすべて拒否する。
 * これにより他クライアントのデータや運用操作へ到達できない (二重防御の外周)。
 */
const CLIENT_ALLOW: { m: string; re: RegExp }[] = [
  { m: 'GET', re: /^\/auth\/me$/ },
  { m: 'POST', re: /^\/auth\/logout$/ },
  { m: 'GET', re: /^\/clients$/ },
  { m: 'GET', re: /^\/clients\/overview$/ },
  { m: 'GET', re: /^\/projects$/ },
  { m: 'GET', re: /^\/projects\/[^/]+$/ },
  { m: 'GET', re: /^\/projects\/[^/]+\/(budget-plan|fatigue)$/ },
  { m: 'GET', re: /^\/projects\/assets\/[^/]+\/(advice|review)$/ },
  { m: 'GET', re: /^\/keywords\/(optimize|discover)$/ },
  { m: 'GET', re: /^\/dashboard$/ },
  { m: 'GET', re: /^\/insights$/ },
  { m: 'GET', re: /^\/reports$/ },
  { m: 'GET', re: /^\/reports\/[^/]+\/(pdf|pptx)$/ },
  { m: 'POST', re: /^\/feedback$/ },
];

@Injectable()
export class ClientScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const scope = clientScopeOf(req);
    if (!scope) return true; // 通常ユーザーは対象外

    const path = req.path.replace(/\/+$/, '') || '/';
    const ok = CLIENT_ALLOW.some((a) => a.m === req.method && a.re.test(path));
    if (!ok) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'この操作は提供先アカウントでは実行できません。',
        '閲覧できるのは自社の実績・レポート・改善提案です。運用操作は代理店側で行われます。',
      );
    }
    return true;
  }
}
