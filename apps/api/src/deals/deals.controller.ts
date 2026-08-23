import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { CreateDealInput, DealDto, DealSummaryDto, UpdateDealInput } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { DealsService } from './deals.service';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('clientId') clientId?: string): Promise<DealDto[]> {
    return this.deals.list(tenantId, clientId);
  }

  @Get('summary')
  summary(@TenantId() tenantId: string, @Query('clientId') clientId: string): Promise<DealSummaryDto> {
    return this.deals.summary(tenantId, clientId);
  }

  @Post()
  create(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Body() body: CreateDealInput): Promise<DealDto> {
    assertEditor(user);
    return this.deals.create(tenantId, body);
  }

  @Put(':id')
  update(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('id') id: string, @Body() body: UpdateDealInput): Promise<DealDto> {
    assertEditor(user);
    return this.deals.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('id') id: string): Promise<{ ok: true }> {
    assertEditor(user);
    return this.deals.remove(tenantId, id);
  }
}
