import { Body, Controller, Param, Post } from '@nestjs/common';
import type { AgentRunDto } from '@adgrid/shared';
import { ClientScope, SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { AgentService } from './agent.service';

@Controller('projects')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post(':id/agent')
  run(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @ClientScope() scope: string | null,
    @Param('id') id: string,
    @Body() body: { instruction?: string },
  ): Promise<AgentRunDto> {
    assertEditor(user);
    return this.agent.run(tenantId, id, body?.instruction ?? '', scope);
  }
}
