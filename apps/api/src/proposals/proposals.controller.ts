import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { CreateProposalInput, ProposalDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
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
    return {
      applyEnabled: await this.proposals.setApplyEnabled(tenantId, body?.applyEnabled !== false, user),
    };
  }
}
