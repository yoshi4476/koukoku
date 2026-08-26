import { Body, Controller, Get, HttpStatus, Param, Post, Put } from '@nestjs/common';
import type { ChildTenantDto, CreateChildTenantInput, TenantConsoleDto } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { ResellerService } from './reseller.service';
import { TenantConsoleService } from './tenant-console.service';
import { AppError } from '../common/errors';

@Controller('reseller/tenants')
export class ResellerController {
  constructor(
    private readonly reseller: ResellerService,
    private readonly console: TenantConsoleService,
  ) {}

  /** テナント横断管理コンソール (F-60)。発行済みテナントの利用状況を一覧する */
  @Get('console')
  tenantConsole(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue): Promise<TenantConsoleDto> {
    return this.console.console(tenantId, user);
  }

  /** 提供先テナントの利用を停止/再開する。停止するとそのテナントは全員ログインできなくなる */
  @Put(':id/status')
  setStatus(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: { status?: string },
  ): Promise<{ ok: true; status: string }> {
    const st = body?.status;
    if (st !== 'active' && st !== 'suspended') {
      throw new AppError(HttpStatus.BAD_REQUEST, '指定が正しくありません。', 'active または suspended を指定してください。');
    }
    return this.console.setStatus(tenantId, user, id, st);
  }

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
