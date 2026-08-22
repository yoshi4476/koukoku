import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { MeasurementConfigDto, MeasurementHealthDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { MeasurementService } from './measurement.service';

@Controller('clients')
export class MeasurementController {
  constructor(private readonly measurement: MeasurementService) {}

  @Get(':clientId/measurement')
  config(@TenantId() tenantId: string, @Param('clientId') clientId: string): Promise<MeasurementConfigDto> {
    return this.measurement.getConfig(tenantId, clientId);
  }

  @Put(':clientId/measurement')
  save(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
    @Body() body: Partial<MeasurementConfigDto>,
  ): Promise<MeasurementConfigDto> {
    assertEditor(user);
    return this.measurement.upsert(tenantId, clientId, body);
  }

  @Get(':clientId/measurement/health')
  health(@TenantId() tenantId: string, @Param('clientId') clientId: string): Promise<MeasurementHealthDto> {
    return this.measurement.health(tenantId, clientId);
  }
}
