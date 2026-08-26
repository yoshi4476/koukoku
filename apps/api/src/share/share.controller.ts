import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { PublicPortalDto, ShareLinkDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { ShareService } from './share.service';

/** 自社側: クライアント共有リンクの発行・停止・状態 */
@Controller('clients')
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get(':clientId/share')
  status(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
  ): Promise<ShareLinkDto> {
    // 公開ポータルのtoken(ログイン不要URLの秘密)を返すため編集権限者に限定する
    assertEditor(user);
    return this.share.status(tenantId, clientId);
  }

  @Post(':clientId/share')
  enable(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('clientId') clientId: string): Promise<ShareLinkDto> {
    assertEditor(user);
    return this.share.enable(tenantId, clientId, user.userId);
  }

  @Delete(':clientId/share')
  disable(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('clientId') clientId: string): Promise<ShareLinkDto> {
    assertEditor(user);
    return this.share.disable(tenantId, clientId, user.userId);
  }
}

/** 公開: ログイン不要の閲覧専用ポータル */
@Controller('share')
export class PublicShareController {
  constructor(private readonly share: ShareService) {}

  @Get(':token')
  portal(@Param('token') token: string): Promise<PublicPortalDto> {
    return this.share.publicPortal(token);
  }
}
