import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from './upload.constants';
import type {
  AdoptCreativeInput,
  AssetAdviceDto,
  BriefExtractDto,
  BudgetPlanDto,
  KeywordPlanDto,
  LaunchSheetDto,
  Platform,
  LaunchPlanDto,
  LaunchResultDto,
  CreateAssetInput,
  CreateProjectInput,
  CreativeGenDto,
  FatigueReportDto,
  ImageGenResultDto,
  PreflightDto,
  ProjectAssetDto,
  ProjectDetailDto,
  ProjectDto,
  ReviewSimDto,
  UpdateAssetInput,
  UpdateProjectInput,
} from '@adgrid/shared';
import { ClientScope, SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { assertEditor } from '../common/authz';
import { isApprover } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ImageGenService } from '../ai/image-gen.service';
import { BriefExtractService } from './brief-extract.service';
import { LaunchService } from './launch.service';
import { KeywordPlanService } from './keyword-plan.service';
import { LaunchSheetService } from './launch-sheet.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly imageGen: ImageGenService,
    private readonly briefExtract: BriefExtractService,
    private readonly launch: LaunchService,
    private readonly keywordPlan: KeywordPlanService,
    private readonly launchSheet: LaunchSheetService,
  ) {}

  /** 媒体別の入稿シート (F-58)。API入稿できない媒体でも規定に沿った入稿ができるようにする */
  @Get(':id/launch-sheet')
  launchSheetFor(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Query('platform') platform?: string,
  ): Promise<LaunchSheetDto> {
    assertEditor(user);
    if (!platform) {
      throw new AppError(HttpStatus.BAD_REQUEST, '媒体が指定されていません。', '媒体を選んでください。');
    }
    return this.launchSheet.sheet(tenantId, id, platform as Platform);
  }

  /** 検索キーワードを自動設計する (F-57)。保存はせず案を返す */
  @Get(':id/keyword-plan')
  keywordPlanFor(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<KeywordPlanDto> {
    assertEditor(user);
    return this.keywordPlan.plan(tenantId, id);
  }

  /** 設計したキーワードと除外キーワードを配信設定へ反映する (F-57) */
  @Post(':id/keyword-plan/apply')
  applyKeywordPlan(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: { plan?: KeywordPlanDto; includeExplore?: boolean },
  ): Promise<{ keywordCount: number; negativeCount: number }> {
    assertEditor(user);
    if (!body?.plan?.keywords?.length) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'キーワード案が空です。', 'もう一度「AIで設計」を実行してください。');
    }
    return this.keywordPlan.apply(tenantId, id, body.plan, !!body.includeExplore);
  }

  /** Google広告への入稿プラン (実行前の確認。API呼出なし) (F-56) */
  @Get(':id/launch-plan')
  launchPlan(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
  ): Promise<LaunchPlanDto> {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '入稿の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
    return this.launch.plan(tenantId, id);
  }

  /** Google広告へ実入稿する (必ず一時停止で作成) (F-56) */
  @Post(':id/launch')
  launchToGoogle(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: { adAccountId?: string },
  ): Promise<LaunchResultDto> {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '入稿の権限がありません。', '広告の入稿はオーナーまたは管理者のみ実行できます。');
    }
    return this.launch.launch(tenantId, id, user, body?.adAccountId);
  }

  /** 作成済みキャンペーンの配信を開始する (ここから課金が始まる) (F-56) */
  @Post(':id/launch/enable')
  enableCampaign(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('id') id: string,
    @Body() body: { externalAccountId: string; campaignId: string },
  ): Promise<{ ok: true; message: string }> {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '配信開始の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
    return this.launch.enable(tenantId, id, user, body);
  }

  /** サイトURLからヒアリングを自動抽出する (F-52)。保存はせず候補を返し、担当者が確認して保存する */
  @Post(':id/brief/from-url')
  extractBrief(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @ClientScope() scope: string | null,
    @Param('id') id: string,
    @Body() body: { url?: string },
  ): Promise<BriefExtractDto> {
    assertEditor(user);
    if (!body?.url?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'URLが入力されていません。', 'クライアントのサイトURLを入力してください。');
    }
    if (scope) {
      throw new AppError(HttpStatus.FORBIDDEN, 'この操作は運用担当のみ実行できます。', '自社運用版で操作してください。');
    }
    return this.briefExtract.fromUrl(tenantId, body.url);
  }

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

  @Get(':id/preflight')
  preflight(@TenantId() tenantId: string, @ClientScope() scope: string | null, @Param('id') id: string): Promise<PreflightDto> {
    return this.projects.preflight(tenantId, id, scope);
  }

  @Delete('assets/:assetId')
  deleteAsset(
    @TenantId() tenantId: string,
    @SessionInfo() user: SessionInfoValue,
    @Param('assetId') assetId: string,
  ): Promise<{ ok: true }> {
    assertEditor(user);
    return this.projects.deleteAsset(tenantId, assetId, user.userId);
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
