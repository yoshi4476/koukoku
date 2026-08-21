import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import type { CopyRunDto, Platform } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { CopyService } from './copy.service';

@Controller('copies')
export class CopyController {
  constructor(private readonly copies: CopyService) {}

  @Post('run')
  run(
    @TenantId() tenantId: string,
    @Body()
    body: {
      clientId?: string;
      platform?: Platform;
      productInfo?: string;
      appealAxes?: string[];
      count?: number;
    },
  ): Promise<CopyRunDto> {
    if (!body?.clientId || !body?.platform) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'クライアントまたは媒体が指定されていません。',
        'クライアントと媒体を選択してから「広告文を生成」をクリックしてください。',
      );
    }
    return this.copies.run(tenantId, {
      clientId: body.clientId,
      platform: body.platform,
      productInfo: body.productInfo ?? '',
      appealAxes: body.appealAxes ?? [],
      count: body.count ?? 3,
    });
  }

  @Get()
  list(@TenantId() tenantId: string, @Query('clientId') clientId?: string): Promise<CopyRunDto[]> {
    return this.copies.list(tenantId, clientId || undefined);
  }
}
