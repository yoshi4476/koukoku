import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { CreateLiftTestInput, LiftTestDto, UpdateLiftTestInput } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { LiftService } from './lift.service';

@Controller('lift-tests')
export class LiftController {
  constructor(private readonly lift: LiftService) {}

  @Get()
  list(@TenantId() tenantId: string): Promise<LiftTestDto[]> {
    return this.lift.list(tenantId);
  }

  @Post()
  create(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Body() body: CreateLiftTestInput): Promise<LiftTestDto> {
    assertEditor(user);
    return this.lift.create(tenantId, body);
  }

  @Put(':id')
  update(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('id') id: string, @Body() body: UpdateLiftTestInput): Promise<LiftTestDto> {
    assertEditor(user);
    return this.lift.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Param('id') id: string): Promise<{ ok: true }> {
    assertEditor(user);
    return this.lift.remove(tenantId, id);
  }
}
