import { Controller, Get } from '@nestjs/common';
import type { BillingDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(@TenantId() tenantId: string): Promise<BillingDto> {
    return this.billing.getBilling(tenantId);
  }
}
