import { HttpStatus, Injectable } from '@nestjs/common';
import type { MeasurementConfigDto, MeasurementHealthDto, ProjectSettings } from '@adgrid/shared';
import { DEFAULT_PROJECT_SETTINGS, measurementHealth } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

type ConfigRow = {
  clientId: string; ga4MeasurementId: string; ga4PropertyId: string; metaPixelId: string;
  serverSideEnabled: boolean; enhancedConversions: boolean; note: string; updatedAt: Date;
};

/** 計測基盤(GA4/CAPI)の設定・ヘルス (F-46) */
@Injectable()
export class MeasurementService {
  constructor(private readonly prisma: PrismaService) {}

  /** サーバーサイド送信の鍵(CAPI/GA4 Measurement Protocol)が設定済みか */
  private get serverKeysReady(): boolean {
    return !!(process.env.META_CAPI_ACCESS_TOKEN || process.env.GA4_API_SECRET);
  }

  private toDto(r: ConfigRow | null, clientId: string): MeasurementConfigDto {
    return {
      clientId,
      ga4MeasurementId: r?.ga4MeasurementId ?? '',
      ga4PropertyId: r?.ga4PropertyId ?? '',
      metaPixelId: r?.metaPixelId ?? '',
      serverSideEnabled: r?.serverSideEnabled ?? false,
      enhancedConversions: r?.enhancedConversions ?? false,
      note: r?.note ?? '',
      updatedAt: r?.updatedAt.toISOString() ?? null,
      serverKeysReady: this.serverKeysReady,
    };
  }

  async getConfig(tenantId: string, clientId: string): Promise<MeasurementConfigDto> {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.measurementConfig.findUnique({ where: { tenantId_clientId: { tenantId, clientId } } }),
    );
    return this.toDto(row as ConfigRow | null, clientId);
  }

  async upsert(tenantId: string, clientId: string, input: Partial<MeasurementConfigDto>): Promise<MeasurementConfigDto> {
    const client = await this.prisma.withTenant(tenantId, (tx) => tx.client.findUnique({ where: { id: clientId } }));
    if (!client) throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
    const data = {
      ga4MeasurementId: input.ga4MeasurementId?.trim() ?? '',
      ga4PropertyId: input.ga4PropertyId?.trim() ?? '',
      metaPixelId: input.metaPixelId?.trim() ?? '',
      serverSideEnabled: !!input.serverSideEnabled,
      enhancedConversions: !!input.enhancedConversions,
      note: input.note ?? '',
    };
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.measurementConfig.upsert({
        where: { tenantId_clientId: { tenantId, clientId } },
        update: data,
        create: { tenantId, clientId, ...data },
      }),
    );
    return this.toDto(row as ConfigRow, clientId);
  }

  /** クライアントの計測ヘルス。CV計測地点はこのクライアントのプロジェクト設定から判定 */
  async health(tenantId: string, clientId: string): Promise<MeasurementHealthDto> {
    const [config, projects] = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.measurementConfig.findUnique({ where: { tenantId_clientId: { tenantId, clientId } } });
      const p = await tx.project.findMany({ where: { clientId }, select: { settings: true } });
      return [c, p] as const;
    });
    const hasCvPoint = projects.some((p) => {
      const s = { ...DEFAULT_PROJECT_SETTINGS, ...(p.settings as object) } as ProjectSettings;
      return !!s.conversionPoint?.trim();
    });
    const cfg = config as ConfigRow | null;
    return measurementHealth({
      hasCvPoint,
      hasGa4: !!cfg?.ga4MeasurementId?.trim(),
      hasPixel: !!cfg?.metaPixelId?.trim(),
      serverSide: !!cfg?.serverSideEnabled,
      enhancedConversions: !!cfg?.enhancedConversions,
      serverKeysReady: this.serverKeysReady,
    });
  }
}
