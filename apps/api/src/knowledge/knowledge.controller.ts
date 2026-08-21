import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { CalibrationDto, KnowledgeSearchDto, KnowledgeAssetDto, PromoteAbTestInput } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { KnowledgeService } from './knowledge.service';
import { CalibrationService } from '../calibration/calibration.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly calibration: CalibrationService,
  ) {}

  @Get()
  search(
    @TenantId() tenantId: string,
    @Query('industryCode') industryCode?: string,
    @Query('objective') objective?: string,
  ): Promise<KnowledgeSearchDto> {
    return this.knowledge.search(tenantId, {
      industryCode: industryCode || undefined,
      objective: objective || undefined,
    });
  }

  @Post('promote')
  promote(@TenantId() tenantId: string, @Body() body: PromoteAbTestInput): Promise<KnowledgeAssetDto> {
    return this.knowledge.promoteFromAbTest(tenantId, body);
  }

  /** 確信度較正の状況 (A-4。設定・診断画面での可視化用) */
  @Get('calibration')
  calibrationSummary(): Promise<CalibrationDto[]> {
    return this.calibration.summary();
  }
}
