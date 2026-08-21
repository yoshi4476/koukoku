import { Body, Controller, Get, HttpStatus, Param, Post, Put } from '@nestjs/common';
import type { CreateProposalInput, ProposalDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { ProposalsService } from './proposals.service';

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  list(@TenantId() tenantId: string): Promise<ProposalDto[]> {
    return this.proposals.list(tenantId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Body() body: CreateProposalInput,
  ): Promise<ProposalDto> {
    return this.proposals.create(tenantId, user, body);
  }

  @Post(':id/approve')
  approve(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<ProposalDto> {
    return this.proposals.approveAndExecute(tenantId, user, id);
  }

  @Post(':id/reject')
  reject(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<ProposalDto> {
    return this.proposals.reject(tenantId, user, id);
  }

  @Post(':id/rollback')
  rollback(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<ProposalDto> {
    return this.proposals.rollback(tenantId, user, id);
  }

  @Post(':id/requeue')
  requeue(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<ProposalDto> {
    return this.proposals.requeue(tenantId, user, id);
  }

  @Get('settings')
  async settings(@TenantId() tenantId: string): Promise<{ applyEnabled: boolean }> {
    return { applyEnabled: await this.proposals.getApplyEnabled(tenantId) };
  }

  @Put('settings')
  async updateSettings(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Body() body: { applyEnabled?: boolean },
  ): Promise<{ applyEnabled: boolean }> {
    // kill switch は誤操作で「有効化」に倒れると危険なため、真偽値の明示を必須にする
    if (typeof body?.applyEnabled !== 'boolean') {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'applyEnabled は true / false で指定してください。',
        '自動適用の有効・無効を明示的に送信してください。',
      );
    }
    return { applyEnabled: await this.proposals.setApplyEnabled(tenantId, body.applyEnabled, user) };
  }
}
