import { Body, Controller, Get, Headers, HttpStatus, Ip, Param, Post, Query } from '@nestjs/common';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { AppError } from '../common/errors';
import { ConversionService, type CollectInput, type CollectResult } from './conversion.service';

/**
 * 公開CV受信エンドポイント (F-55)。
 * クライアントのサイト(サンクスページ)から token 付きで叩かれる。認証は token のみ。
 */
@Controller('collect')
export class CollectController {
  constructor(private readonly conversions: ConversionService) {}

  @Post(':token')
  collect(
    @Param('token') token: string,
    @Body() body: CollectInput,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<CollectResult> {
    return this.conversions.collect(token, body ?? {}, { ip, userAgent });
  }
}

/** 自社側: CV受信トークンの発行と、受信状況の確認 */
@Controller('clients')
export class ConversionAdminController {
  constructor(private readonly conversions: ConversionService) {}

  @Post(':clientId/measurement/token')
  issue(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
  ): Promise<{ token: string; endpoint: string }> {
    assertEditor(user);
    return this.conversions.issueToken(tenantId, clientId).then((token) => ({
      token,
      endpoint: `${process.env.API_ORIGIN ?? 'http://localhost:4000'}/collect/${token}`,
    }));
  }

  @Get(':clientId/measurement/events')
  async events(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
    @Query('limit') limit?: string,
  ) {
    if (user.clientScopeId && user.clientScopeId !== clientId) {
      throw new AppError(HttpStatus.NOT_FOUND, 'データが見つかりません。', 'クライアントを選び直してください。');
    }
    return this.conversions.recent(tenantId, clientId, Number(limit) || 20);
  }
}
