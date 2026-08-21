import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { CreateProjectInput, ProjectDetailDto, ProjectDto, UpdateProjectInput } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
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
}
