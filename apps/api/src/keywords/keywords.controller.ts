import { Controller, Get, Query } from '@nestjs/common';
import type { KeywordOptimizeDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
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
}
