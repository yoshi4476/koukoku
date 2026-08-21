import { Body, Controller, Get, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { MeDto } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { AuthService, SESSION_COOKIE, verifySession } from './auth.service';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  // ローカル開発はhttpのため secure なし。本番デプロイ時に secure: true を必須化
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

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
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request): Promise<MeDto> {
    const token = (req.cookies ?? {})[SESSION_COOKIE] as string | undefined;
    const session = token ? verifySession(token) : null;
    if (!session) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'ログインしていません。',
        'ログイン画面からサインインしてください。',
      );
    }
    return this.auth.me(session);
  }
}
