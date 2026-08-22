import { Controller, Get } from '@nestjs/common';
import type { InsightDigestDto } from '@adgrid/shared';
import { ClientScope, TenantId } from '../common/tenant';
import { InsightsService } from './insights.service';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  digest(@TenantId() tenantId: string, @ClientScope() scope: string | null): Promise<InsightDigestDto> {
    return this.insights.digest(tenantId, scope);
  }
}
