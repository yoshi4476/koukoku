import { Body, Controller, Get, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { PlatformConsoleDto, PlatformHealthDto } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { PlatformService } from './platform.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { PlatformAdmin, PlatformAdminGuard, type PlatformAdminValue } from './platform-admin.guard';

/**
 * システム管理API (F-61)。SaaS運営者専用。
 * 権限は PLATFORM_ADMIN_EMAILS のみで決まり、テナント内のロールでは到達できない。
 */
@Controller('platform')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly reset: PasswordResetService,
  ) {}

  /**
   * パスワード再設定リンクの発行 (F-62)。
   * メール基盤が無くても運用できるよう、運営がリンクを直接渡せるようにする。
   */
  @Post('password-reset-link')
  async passwordResetLink(
    @PlatformAdmin() admin: PlatformAdminValue,
    @Body() body: { email?: string },
  ): Promise<{ url: string; email: string }> {
    return this.reset.issueLinkFor(body?.email ?? '', 'platform');
  }

  /** ログイン中のユーザーがシステム管理者かの確認 (画面のガードに使う) */
  @Get('me')
  me(@PlatformAdmin() admin: PlatformAdminValue): { email: string } {
    return { email: admin.email };
  }

  /** 全テナントの一覧とシステム全体のKPI */
  @Get('console')
  console(): Promise<PlatformConsoleDto> {
    return this.platform.console();
  }

  /** 実行基盤・外部連携の稼働状況 */
  @Get('health')
  health(): Promise<PlatformHealthDto> {
    return this.platform.health();
  }

  @Put('tenants/:id/status')
  setStatus(
    @PlatformAdmin() admin: PlatformAdminValue,
    @Param('id') id: string,
    @Body() body: { status?: string },
  ) {
    const st = body?.status;
    if (st !== 'active' && st !== 'suspended') {
      throw new AppError(HttpStatus.BAD_REQUEST, '指定が正しくありません。', 'active または suspended を指定してください。');
    }
    return this.platform.setStatus(admin, id, st);
  }

  @Put('tenants/:id/plan')
  setPlan(
    @PlatformAdmin() admin: PlatformAdminValue,
    @Param('id') id: string,
    @Body() body: { plan?: string },
  ) {
    return this.platform.setPlan(admin, id, (body?.plan ?? '').trim());
  }
}
