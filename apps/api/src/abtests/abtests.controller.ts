import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AbTestDto, CreateAbTestInput } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AbTestsService } from './abtests.service';

@Controller('abtests')
export class AbTestsController {
  constructor(private readonly abtests: AbTestsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('clientId') clientId?: string): Promise<AbTestDto[]> {
    return this.abtests.list(tenantId, clientId || undefined);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() body: CreateAbTestInput): Promise<AbTestDto> {
    return this.abtests.create(tenantId, body);
  }

  @Post(':id/conclude')
  conclude(@TenantId() tenantId: string, @Param('id') id: string): Promise<AbTestDto> {
    return this.abtests.conclude(tenantId, id);
  }
}
