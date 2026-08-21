import {
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { CsvImportResultDto } from '@adgrid/shared';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { CsvService } from './csv.service';

@Controller('imports')
export class ImportsController {
  constructor(private readonly csv: CsvService) {}

  @Post('csv')
  @UseInterceptors(FileInterceptor('file'))
  importCsv(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { adAccountId?: string },
  ): Promise<CsvImportResultDto> {
    if (!file) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'ファイルが選択されていません。',
        'CSVファイルを選択してからアップロードしてください。',
      );
    }
    if (!body?.adAccountId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '取込先の広告アカウントが指定されていません。',
        'アカウントを選択してからアップロードしてください。',
      );
    }
    return this.csv.import(tenantId, body.adAccountId, file.originalname, file.buffer);
  }
}
