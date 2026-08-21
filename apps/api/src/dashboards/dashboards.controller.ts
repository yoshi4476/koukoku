import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { DashboardDef, DashboardListDto, WidgetDataDto, WidgetDef } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { DashboardsService } from './dashboards.service';

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  list(@TenantId() tenantId: string): Promise<DashboardListDto> {
    return this.dashboards.list(tenantId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Body() body: { name?: string },
  ): Promise<DashboardDef> {
    return this.dashboards.create(tenantId, user.userId, body?.name ?? '');
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string): Promise<DashboardDef> {
    return this.dashboards.get(tenantId, id);
  }

  @Put(':id')
  save(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; layout?: WidgetDef[] },
  ): Promise<DashboardDef> {
    return this.dashboards.saveLayout(tenantId, id, body?.name ?? '', body?.layout ?? []);
  }

  @Delete(':id')
  async remove(@TenantId() tenantId: string, @Param('id') id: string): Promise<{ ok: true }> {
    await this.dashboards.remove(tenantId, id);
    return { ok: true };
  }

  @Get(':id/data')
  data(@TenantId() tenantId: string, @Param('id') id: string): Promise<WidgetDataDto[]> {
    return this.dashboards.widgetData(tenantId, id);
  }
}
