import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { CreateFeedbackInput, FeedbackDto } from '@adgrid/shared';
import { ClientScope, SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { FeedbackService } from './feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** 提供先(client)ユーザーが送信 */
  @Post()
  create(
    @TenantId() tenantId: string,
    @ClientScope() scope: string | null,
    @SessionInfo() user: SessionInfoValue,
    @Body() body: CreateFeedbackInput,
  ): Promise<FeedbackDto> {
    return this.feedback.create(tenantId, scope, user, body);
  }

  /** 自社(運用)が確認。viewer や提供先には見せない (提供先メッセージが含まれるため) */
  @Get()
  list(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue): Promise<FeedbackDto[]> {
    assertEditor(user);
    return this.feedback.list(tenantId);
  }

  @Post(':id/resolve')
  resolve(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<FeedbackDto> {
    assertEditor(user);
    return this.feedback.resolve(tenantId, id);
  }
}
