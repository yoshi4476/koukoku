import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import type { IntegrationStatusDto, IntegrationStatusItem } from '@adgrid/shared';
import { isApprover } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { LlmService } from '../ai/llm.service';

/** 外部連携の有効化状況・接続テスト (F-48)。owner/admin のみ */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly llm: LlmService) {}

  private assertManager(user: SessionInfoValue) {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
  }

  @Get('status')
  status(@SessionInfo() user: SessionInfoValue): IntegrationStatusDto {
    this.assertManager(user);
    const has = (...keys: string[]) => keys.every((k) => !!process.env[k]);
    const items: IntegrationStatusItem[] = [
      {
        key: 'anthropic', label: 'Claude（実AI）', category: '実AI', envVars: ['ANTHROPIC_API_KEY'],
        configured: has('ANTHROPIC_API_KEY'),
        activates: '広告文・AI診断・レポート・クリエイティブ生成が実Claudeで動作',
        fallback: '業種データに基づく決定的テンプレートで動作（品質は維持）',
      },
      {
        key: 'imagen', label: '画像生成（Imagen 4）', category: '画像生成', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        configured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        activates: '制作物へのAI画像生成（Imagen）。原価はAI利用量に合算',
        fallback: '生成は不可。プロンプトのコピー提供と自動バナーで代替',
      },
      {
        key: 'meta_capi', label: 'Meta CAPI（サーバーサイドCV）', category: '計測', envVars: ['META_CAPI_ACCESS_TOKEN'],
        configured: has('META_CAPI_ACCESS_TOKEN'),
        activates: 'サーバー側でCVをMetaへ送信。iOS/クッキー制限に強い計測',
        fallback: '計測ヘルスで「サーバーサイド計測 未達」と表示',
      },
      {
        key: 'ga4_mp', label: 'GA4 Measurement Protocol', category: '計測', envVars: ['GA4_API_SECRET'],
        configured: has('GA4_API_SECRET'),
        activates: 'サーバー側でCVをGA4へ送信し計測の取りこぼしを補完',
        fallback: '計測ヘルスで「サーバーサイド計測 未達」と表示',
      },
      {
        key: 'google_ads', label: 'Google広告（実配信）', category: '実配信', envVars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'],
        configured: has('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'),
        activates: 'Google広告アカウントへの実接続・実データ同期・実入稿',
        fallback: 'デモ接続モード（決定的なサンプルデータで同期）',
      },
      {
        key: 'slack', label: 'Slack連携', category: '連携', envVars: ['SLACK_SIGNING_SECRET'],
        configured: has('SLACK_SIGNING_SECRET'),
        activates: 'Slackスラッシュコマンドの署名検証（本番の安全な受付）',
        fallback: '開発モード（署名検証スキップ）でコマンドは動作',
      },
    ];
    return { items, readyCount: items.filter((i) => i.configured).length, total: items.length };
  }

  /** 実Claudeの接続テスト（最小・低コスト）。実際に1回呼び出して疎通を確認 */
  @Post('test/anthropic')
  async testAnthropic(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue): Promise<{ ok: boolean; message: string }> {
    this.assertManager(user);
    if (!this.llm.available) {
      return { ok: false, message: 'ANTHROPIC_API_KEY が未設定です。.env に設定してAPIを再起動してください。' };
    }
    try {
      const text = await this.llm.completeText({
        tenantId, feature: 'copy', model: 'claude-haiku-4-5',
        system: 'あなたは接続テスト応答器です。ユーザーの指示どおり短く返答します。',
        user: '接続テストです。「接続OK」とだけ日本語で返答してください。',
        maxTokens: 20, promptVersion: 'integration.test',
      });
      return { ok: true, message: `実Claude 接続OK（応答: ${text.trim().slice(0, 30)}）` };
    } catch {
      return { ok: false, message: '接続に失敗しました。鍵・ネットワーク・モデル名を確認してください。' };
    }
  }
}
