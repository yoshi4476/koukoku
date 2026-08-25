import { Body, Controller, Get, HttpStatus, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Edition, MeDto } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { AuthService, SESSION_COOKIE, verifySession } from './auth.service';

/**
 * セッションCookieの設定。
 *
 * Web と API を別ドメインに置く構成 (例: Web=Vercel / API=Railway) では、
 * ブラウザから見て「クロスサイト」になるため SameSite=Lax ではCookieが送られず
 * ログインできない。本番では SameSite=None + Secure にする必要がある
 * (SameSite=None は Secure 必須。つまり HTTPS でしか動かない)。
 *
 * ローカル開発は http のため Lax のまま (同一サイト扱いで問題なく動く)。
 * CROSS_SITE_COOKIE=false を明示すれば、同一ドメイン構成で Lax に固定できる。
 */
const IS_PROD = process.env.NODE_ENV === 'production';
const CROSS_SITE = process.env.CROSS_SITE_COOKIE === 'false' ? false : IS_PROD;

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: (CROSS_SITE ? 'none' : 'lax') as 'none' | 'lax',
  // SameSite=None は Secure 必須。本番は常に HTTPS 前提
  secure: CROSS_SITE || IS_PROD,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** clearCookie は set 時と同じ属性でないとブラウザが削除しない */
const CLEAR_OPTS = { path: '/', sameSite: COOKIE_OPTS.sameSite, secure: COOKIE_OPTS.secure };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly trail: TrailService,
  ) {}

  @Post('signup')
  async signup(
    @Body() body: { email?: string; password?: string; name?: string; tenantName?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const { me, token } = await this.auth.signup({
      email: body?.email ?? '',
      password: body?.password ?? '',
      name: body?.name ?? '',
      tenantName: body?.tenantName ?? '',
    });
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    await this.trail.record({ tenantId: me.tenantId, userId: me.userId, action: 'signup', ip: req.ip });
    return me;
  }

  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const { me, token } = await this.auth.login(body?.email ?? '', body?.password ?? '');
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    await this.trail.record({ tenantId: me.tenantId, userId: me.userId, action: 'login', ip: req.ip });
    return me;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(SESSION_COOKIE, CLEAR_OPTS);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request): Promise<MeDto> {
    return this.auth.me(this.requireSession(req));
  }

  @Put('tenant')
  async switchTenant(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { tenantId?: string },
  ): Promise<MeDto> {
    if (!body?.tenantId) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'テナントが指定されていません。', '切り替え先を選んでください。');
    }
    const { me, token } = await this.auth.switchTenant(this.requireSession(req), body.tenantId);
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    return me;
  }

  @Put('edition')
  async setEdition(@Req() req: Request, @Body() body: { edition?: string }): Promise<MeDto> {
    if (body?.edition !== 'agency' && body?.edition !== 'client') {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '版の指定が不正です。',
        'agency または client を指定してください。',
      );
    }
    return this.auth.setEdition(this.requireSession(req), body.edition as Edition);
  }

  private requireSession(req: Request) {
    const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
    const session = token ? verifySession(token) : null;
    if (!session) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'ログインしていません。',
        'ログイン画面からサインインしてください。',
      );
    }
    return session;
  }
}
