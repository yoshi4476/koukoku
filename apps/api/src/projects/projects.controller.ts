import { Body, Controller, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from './upload.constants';
import type {
  AdoptCreativeInput,
  AssetAdviceDto,
  BudgetPlanDto,
  CreateAssetInput,
  CreateProjectInput,
  CreativeGenDto,
  FatigueReportDto,
  ImageGenResultDto,
  ProjectAssetDto,
  ProjectDetailDto,
  ProjectDto,
  ReviewSimDto,
  UpdateAssetInput,
  UpdateProjectInput,
} from '@adgrid/shared';
import { ClientScope, SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { ProjectsService } from './projects.service';
import { ImageGenService } from '../ai/image-gen.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly imageGen: ImageGenService,
  ) {}

  @Get()
  list(@TenantId() tenantId: string, @ClientScope() scope: string | null): Promise<ProjectDto[]> {
    return this.projects.list(tenantId, scope);
  }

  @Get(':id')
  detail(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projects.detail(tenantId, id, scope);
  }

  @Post()
  create(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue, @Body() body: CreateProjectInput): Promise<ProjectDto> {
    assertEditor(user);
    return this.projects.create(tenantId, body);
  }

  @Put(':id')
  update(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    assertEditor(user);
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
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: CreateAssetInput,
  ): Promise<ProjectAssetDto> {
    assertEditor(user);
    return this.projects.createAsset(tenantId, id, body);
  }

  @Put('assets/:assetId')
  updateAsset(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('assetId') assetId: string,
    @Body() body: UpdateAssetInput,
  ): Promise<ProjectAssetDto> {
    assertEditor(user);
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

  @Post('assets/:assetId/generate-image')
  generateImage(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('assetId') assetId: string,
    @Body() body: { prompt?: string; aspectRatio?: string; model?: string; count?: number },
  ): Promise<ImageGenResultDto> {
    assertEditor(user);
    return this.imageGen.generateForAsset(tenantId, assetId, {
      prompt: body?.prompt ?? '',
      aspectRatio: body?.aspectRatio,
      model: body?.model,
      count: body?.count,
    });
  }

  @Post('assets/:assetId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadAsset(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('assetId') assetId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<ProjectAssetDto> {
    assertEditor(user);
    return this.projects.attachUpload(tenantId, assetId, file);
  }

  /* ---- 業種特化クリエイティブ生成 (F-26) ---- */

  @Get(':id/creatives')
  creatives(
    @TenantId() tenantId: string,
    @ClientScope() scope: string | null,
    @Param('id') id: string,
    @Query('count') count?: string,
  ): Promise<CreativeGenDto> {
    return this.projects.generateCreatives(tenantId, id, Number(count) || 4, scope);
  }

  @Post(':id/creatives/adopt')
  adoptCreatives(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: AdoptCreativeInput,
  ): Promise<ProjectAssetDto[]> {
    assertEditor(user);
    return this.projects.adoptCreatives(tenantId, id, body);
  }

  @Get('assets/:assetId/advice')
  advice(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('assetId') assetId: string): Promise<AssetAdviceDto> {
    return this.projects.adviceForAsset(tenantId, assetId, scope);
  }

  @Get('assets/:assetId/review')
  review(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('assetId') assetId: string): Promise<ReviewSimDto> {
    return this.projects.reviewAsset(tenantId, assetId, scope);
  }

  @Get(':id/budget-plan')
  budgetPlan(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('id') id: string): Promise<BudgetPlanDto> {
    return this.projects.budgetPlan(tenantId, id, scope);
  }

  @Get(':id/fatigue')
  fatigue(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('id') id: string): Promise<FatigueReportDto> {
    return this.projects.creativeFatigue(tenantId, id, scope);
  }
}
