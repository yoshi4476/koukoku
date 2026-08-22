import { Controller, Get } from '@nestjs/common';
import type { InsightDigestDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { InsightsService } from './insights.service';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  digest(@TenantId() tenantId: string): Promise<InsightDigestDto> {
    return this.insights.digest(tenantId);
  }
}
