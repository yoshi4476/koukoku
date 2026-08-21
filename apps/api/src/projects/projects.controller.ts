import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type {
  CreateAssetInput,
  CreateProjectInput,
  ProjectAssetDto,
  ProjectDetailDto,
  ProjectDto,
  UpdateAssetInput,
  UpdateProjectInput,
} from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@TenantId() tenantId: string): Promise<ProjectDto[]> {
    return this.projects.list(tenantId);
  }

  @Get(':id')
  detail(@TenantId() tenantId: string, @Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projects.detail(tenantId, id);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() body: CreateProjectInput): Promise<ProjectDto> {
    return this.projects.create(tenantId, body);
  }

  @Put(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.update(tenantId, id, body);
  }

  /* ---- 制作物 (広告文/LP/チラシ/動画) ---- */

  @Get(':id/assets')
  assets(@TenantId() tenantId: string, @Param('id') id: string): Promise<ProjectAssetDto[]> {
    return this.projects.listAssets(tenantId, id);
  }

  @Post(':id/assets')
  createAsset(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: CreateAssetInput,
  ): Promise<ProjectAssetDto> {
    return this.projects.createAsset(tenantId, id, body);
  }

  @Put('assets/:assetId')
  updateAsset(
    @TenantId() tenantId: string,
    @Param('assetId') assetId: string,
    @Body() body: UpdateAssetInput,
  ): Promise<ProjectAssetDto> {
    return this.projects.updateAsset(tenantId, assetId, body);
  }

  @Post('assets/:assetId/publish')
  publishAsset(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('assetId') assetId: string,
  ): Promise<ProjectAssetDto> {
    return this.projects.publishAsset(tenantId, assetId, user);
  }
}
