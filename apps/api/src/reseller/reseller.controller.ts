import { Body, Controller, Get, Post } from '@nestjs/common';
import type { ChildTenantDto, CreateChildTenantInput } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { ResellerService } from './reseller.service';

@Controller('reseller/tenants')
export class ResellerController {
  constructor(private readonly reseller: ResellerService) {}

  @Get()
  list(@TenantId() tenantId: string): Promise<ChildTenantDto[]> {
    return this.reseller.list(tenantId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Body() body: CreateChildTenantInput,
  ): Promise<ChildTenantDto> {
    return this.reseller.create(tenantId, user, body);
  }
}
