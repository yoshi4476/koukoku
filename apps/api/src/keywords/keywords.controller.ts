import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { KeywordOptimizeDto, ProposalDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { KeywordsService } from './keywords.service';

@Controller('keywords')
export class KeywordsController {
  constructor(private readonly keywords: KeywordsService) {}

  @Get('optimize')
  optimize(
    @TenantId() tenantId: string,
    @Query('clientId') clientId?: string,
    @Query('q') q?: string,
  ): Promise<KeywordOptimizeDto> {
    return this.keywords.optimize(tenantId, { clientId: clientId || undefined, query: q || undefined });
  }

  @Post(':id/propose')
  propose(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<ProposalDto> {
    return this.keywords.propose(tenantId, user, id);
  }
}
