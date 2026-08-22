import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { ClientAccessDto, CreateClientAccessInput } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { AccessService } from './access.service';

@Controller('clients')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get(':clientId/access')
  list(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
  ): Promise<ClientAccessDto[]> {
    return this.access.list(tenantId, clientId, user);
  }

  @Post(':clientId/access')
  create(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('clientId') clientId: string,
    @Body() body: CreateClientAccessInput,
  ): Promise<ClientAccessDto> {
    return this.access.create(tenantId, clientId, body, user);
  }

  @Delete(':clientId/access/:userId')
  revoke(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('userId') userId: string,
  ): Promise<{ ok: true }> {
    return this.access.revoke(tenantId, userId, user);
  }
}
