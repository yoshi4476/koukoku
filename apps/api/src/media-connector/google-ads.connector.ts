import { HttpStatus } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../common/errors';
import { decryptSecret } from '../common/token-crypto';
import {
  BaseConnector,
  type ApplyResult,
  type AuthorizeResult,
  type ChangeRequest,
  type DateRange,
  type ExternalAccount,
  type NormalizedRow,
} from './core';

/**
 * Google広告 実API接続 (F-54)。
 * 必要な環境変数:
 *   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN
 * 任意:
 *   GOOGLE_ADS_API_VERSION (既定 v21) — Googleがバージョンを定期的に打ち切るため、
 *   サポート対象外エラーが出たら現行バージョンに更新する。
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — MCC ID (ハイフン無し)。接続時に保存されていればそちらを優先。
 *
 * REST (googleads.googleapis.com) を fetch で直接叩く。gRPCクライアントを持ち込まず依存を増やさない。
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_HOST = 'https://googleads.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/adwords';
/** 1リクエストの上限。日次×キャンペーンなら十分 */
const PAGE_SIZE = 10_000;
const MAX_PAGES = 20;

type Tokens = { accessToken: string; expiresAt: number };

function apiVersion(): string {
  return process.env.GOOGLE_ADS_API_VERSION || 'v21';
}
function digitsOnly(v: string): string {
  return (v || '').replace(/[^0-9]/g, '');
}
/** micros(100万分の1通貨単位) → 円 */
function fromMicros(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}
function toMicros(yen: number): string {
  return String(Math.round(yen * 1_000_000));
}
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export class GoogleAdsConnector extends BaseConnector {
  readonly platform = 'google_ads' as const;

  /** アクセストークンはプロセス内で短期キャッシュ (テナント×プラットフォーム単位) */
  private static tokenCache = new Map<string, Tokens>();

  /**
   * @param prisma 接続情報(暗号化トークン)の読み出しに使う。RLS配下のテナント接続を渡すこと
   * @param tenantId 対象テナント
   */
  constructor(
    private readonly prisma: Pick<PrismaClient, 'mediaConnection'>,
    private readonly tenantId: string,
  ) {
    super();
  }

  static get configured(): boolean {
    return Boolean(
      process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    );
  }

  private static assertConfigured(): void {
    if (!GoogleAdsConnector.configured) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'Google広告の実API接続はまだ設定されていません。',
        '開発者トークンとOAuthクライアントを取得し GOOGLE_ADS_* 環境変数を設定してください。それまではデモ接続をご利用いただけます。',
      );
    }
  }

  /** 認可URL。ユーザーがGoogleで同意すると /connections/google_ads/callback に code が返る */
  async authorize(_tenantId: string): Promise<AuthorizeResult> {
    GoogleAdsConnector.assertConfigured();
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      redirect_uri: GoogleAdsConnector.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent', // 毎回 refresh_token を確実に得るため
      state: this.tenantId,
    });
    return { mode: 'oauth', authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  static redirectUri(): string {
    return `${process.env.API_ORIGIN ?? 'http://localhost:4000'}/connections/google_ads/callback`;
  }

  /** 認可コードをリフレッシュトークンに交換する (コールバックから呼ぶ) */
  static async exchangeCode(code: string): Promise<{ refreshToken: string }> {
    GoogleAdsConnector.assertConfigured();
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      redirect_uri: GoogleAdsConnector.redirectUri(),
      grant_type: 'authorization_code',
    });
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !json.refresh_token) {
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        `Google認証に失敗しました (${res.status})。`,
        typeof json.error_description === 'string'
          ? json.error_description
          : 'もう一度「接続する」からやり直してください。同意画面で権限を許可する必要があります。',
      );
    }
    return { refreshToken: String(json.refresh_token) };
  }

  /* ---------------- 内部: 認証情報の取得 ---------------- */

  private async connectionRow() {
    const row = await this.prisma.mediaConnection.findUnique({
      where: { tenantId_platform: { tenantId: this.tenantId, platform: 'google_ads' } },
    });
    if (!row || !row.refreshTokenEnc) {
      throw new AppError(
        HttpStatus.PRECONDITION_REQUIRED,
        'Google広告アカウントが接続されていません。',
        '「API接続」画面からGoogle広告を接続してください。',
      );
    }
    return row;
  }

  private async accessToken(): Promise<string> {
    const cacheKey = `${this.tenantId}:google_ads`;
    const cached = GoogleAdsConnector.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

    const row = await this.connectionRow();
    const refreshToken = decryptSecret(row.refreshTokenEnc);
    if (!refreshToken) {
      throw new AppError(
        HttpStatus.PRECONDITION_REQUIRED,
        '保存された認証情報を復号できませんでした。',
        '暗号化キーが変更された可能性があります。Google広告を再接続してください。',
      );
    }
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !json.access_token) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'Google広告の認証が失効しました。',
        '「API接続」画面からGoogle広告を再接続してください。',
      );
    }
    const token = { accessToken: String(json.access_token), expiresAt: Date.now() + num(json.expires_in) * 1000 };
    GoogleAdsConnector.tokenCache.set(cacheKey, token);
    return token.accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    const row = await this.connectionRow();
    const login = digitsOnly(row.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
    const h: Record<string, string> = {
      authorization: `Bearer ${await this.accessToken()}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      'content-type': 'application/json',
    };
    if (login) h['login-customer-id'] = login;
    return h;
  }

  /** APIエラーを利用者に伝わる形へ変換する */
  private static toAppError(status: number, json: unknown): AppError {
    const j = json as { error?: { message?: string; details?: unknown[] } };
    const msg = j?.error?.message ?? '';
    if (status === 401 || status === 403) {
      if (/developer token/i.test(msg)) {
        return new AppError(HttpStatus.FORBIDDEN, 'Google広告の開発者トークンが承認されていません。',
          'テストアカウント権限のままの可能性があります。本番アカウントを操作するには「ベーシックアクセス」の承認が必要です。');
      }
      return new AppError(HttpStatus.FORBIDDEN, 'Google広告APIへのアクセスが拒否されました。',
        `権限またはMCC設定を確認してください。${msg}`.trim());
    }
    if (status === 404 && /version/i.test(msg)) {
      return new AppError(HttpStatus.BAD_GATEWAY, 'Google広告APIのバージョンがサポート対象外です。',
        `GOOGLE_ADS_API_VERSION を現行バージョンに更新してください (現在: ${apiVersion()})。`);
    }
    if (status === 429) {
      return new AppError(HttpStatus.TOO_MANY_REQUESTS, 'Google広告APIのレート制限に達しました。',
        'しばらく時間をおいて再実行してください。');
    }
    return new AppError(HttpStatus.BAD_GATEWAY, `Google広告APIエラー (${status})。`,
      msg || 'しばらく時間をおいて再実行してください。');
  }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    GoogleAdsConnector.assertConfigured();
    const res = await fetch(`${ADS_HOST}/${apiVersion()}/${path}`, {
      method: init?.method ?? 'GET',
      headers: await this.headers(),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw GoogleAdsConnector.toAppError(res.status, json);
    return json as T;
  }

  /** GAQL検索。ページングを追い切って全行返す */
  private async search(customerId: string, query: string): Promise<Record<string, any>[]> {
    const cid = digitsOnly(customerId);
    const out: Record<string, any>[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const body: Record<string, unknown> = { query, pageSize: PAGE_SIZE };
      if (pageToken) body.pageToken = pageToken;
      const json = await this.call<{ results?: Record<string, any>[]; nextPageToken?: string }>(
        `customers/${cid}/googleAds:search`,
        { method: 'POST', body },
      );
      out.push(...(json.results ?? []));
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /* ---------------- 読み取り ---------------- */

  /** 操作可能な広告アカウント一覧 (MCC配下) */
  async fetchAccounts(_tenantId: string): Promise<ExternalAccount[]> {
    const row = await this.connectionRow();
    const login = digitsOnly(row.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
    // MCCがあれば配下を列挙。無ければアクセス可能な顧客IDを列挙する
    if (login) {
      const rows = await this.search(login, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status
        FROM customer_client
        WHERE customer_client.status = 'ENABLED'
      `);
      return rows
        .filter((r) => r.customerClient && !r.customerClient.manager)
        .map((r) => ({
          externalAccountId: String(r.customerClient.id),
          name: String(r.customerClient.descriptiveName ?? r.customerClient.id),
        }));
    }
    const res = await this.call<{ resourceNames?: string[] }>('customers:listAccessibleCustomers');
    return (res.resourceNames ?? []).map((rn) => {
      const id = rn.split('/').pop() ?? '';
      return { externalAccountId: id, name: id };
    });
  }

  /** 日次×キャンペーンの実績を取得して正規化する */
  async fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]> {
    const query = `
      SELECT
        segments.date,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${range.since}' AND '${range.until}'
    `;
    const rows = await this.search(externalAccountId, query);
    return rows.map((r) => ({
      date: String(r.segments?.date ?? range.since),
      campaignId: String(r.campaign?.id ?? ''),
      campaignName: String(r.campaign?.name ?? ''),
      impressions: num(r.metrics?.impressions),
      clicks: num(r.metrics?.clicks),
      cost: fromMicros(r.metrics?.costMicros),
      conversions: num(r.metrics?.conversions),
      conversionValue: num(r.metrics?.conversionsValue),
    }));
  }

  /* ---------------- 書き込み (承認済みのみ到達) ---------------- */

  protected async doApplyChange(change: ChangeRequest): Promise<ApplyResult> {
    const payload = change.payload as Record<string, unknown>;
    const customerId = digitsOnly(String(payload.customerId ?? payload.externalAccountId ?? ''));
    if (!customerId) {
      throw new AppError(HttpStatus.BAD_REQUEST, '対象のGoogle広告アカウントが特定できません。',
        'アカウントの外部IDが設定されているか確認してください。');
    }

    if (change.operation === 'update_budget') {
      // キャンペーンから予算リソース名を引いてから金額を更新する
      const rows = await this.search(customerId, `
        SELECT campaign.id, campaign.name, campaign_budget.resource_name
        FROM campaign WHERE campaign.id = ${Number(digitsOnly(change.externalId)) || 0}
      `);
      const budgetRes = rows[0]?.campaignBudget?.resourceName as string | undefined;
      if (!budgetRes) {
        throw new AppError(HttpStatus.NOT_FOUND, 'キャンペーン予算が見つかりません。', 'キャンペーンIDを確認してください。');
      }
      const yen = Number(payload.newMonthlyBudget ?? payload.amount ?? 0);
      // Google広告の予算は「日予算」。月予算は 30.4 で割って日額換算する
      const daily = yen > 0 ? yen / 30.4 : 0;
      await this.call(`customers/${customerId}/campaignBudgets:mutate`, {
        method: 'POST',
        body: {
          operations: [{ update: { resourceName: budgetRes, amountMicros: toMicros(daily) }, updateMask: 'amount_micros' }],
        },
      });
      return { success: true, note: `日予算を約${Math.round(daily).toLocaleString('ja-JP')}円 (月${Math.round(yen).toLocaleString('ja-JP')}円相当) に変更しました。`, simulated: false };
    }

    if (change.operation === 'update_status') {
      const status = String(payload.status ?? 'PAUSED').toUpperCase() === 'ENABLED' ? 'ENABLED' : 'PAUSED';
      const id = digitsOnly(change.externalId);
      const resource = change.entity === 'adgroup' ? 'adGroups' : 'campaigns';
      const resourceName = `customers/${customerId}/${change.entity === 'adgroup' ? 'adGroups' : 'campaigns'}/${id}`;
      await this.call(`customers/${customerId}/${resource}:mutate`, {
        method: 'POST',
        body: { operations: [{ update: { resourceName, status }, updateMask: 'status' }] },
      });
      return { success: true, note: `${change.entity === 'adgroup' ? '広告グループ' : 'キャンペーン'}を${status === 'ENABLED' ? '配信中' : '停止'}にしました。`, simulated: false };
    }

    if (change.operation === 'update_bid') {
      const criterionId = digitsOnly(String(payload.criterionId ?? change.externalId));
      const adGroupId = digitsOnly(String(payload.adGroupId ?? ''));
      if (!adGroupId || !criterionId) {
        throw new AppError(HttpStatus.BAD_REQUEST, '入札変更には広告グループIDとキーワードIDが必要です。',
          'キーワード最適化から申請した提案をご利用ください。');
      }
      const bidYen = Number(payload.newBid ?? payload.cpcBid ?? 0);
      await this.call(`customers/${customerId}/adGroupCriteria:mutate`, {
        method: 'POST',
        body: {
          operations: [{
            update: { resourceName: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`, cpcBidMicros: toMicros(bidYen) },
            updateMask: 'cpc_bid_micros',
          }],
        },
      });
      return { success: true, note: `入札単価を${Math.round(bidYen).toLocaleString('ja-JP')}円に変更しました。`, simulated: false };
    }

    throw new AppError(HttpStatus.NOT_IMPLEMENTED, 'この操作はGoogle広告では未対応です。', '予算・入札・ステータスの変更に対応しています。');
  }

  /* ---------------- アカウント作成 / 入稿 (F-56) ---------------- */

  /**
   * MCC配下に広告アカウントを新規作成する。
   * ベーシックアクセス承認前は本番アカウントを作成できない (テストアカウントのみ)。
   */
  async createAccount(input: { name: string; timeZone?: string; currencyCode?: string }): Promise<ExternalAccount> {
    const row = await this.connectionRow();
    const mcc = digitsOnly(row.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
    if (!mcc) {
      throw new AppError(HttpStatus.PRECONDITION_REQUIRED, 'マネージャーアカウント(MCC)が設定されていません。',
        '.env の GOOGLE_ADS_LOGIN_CUSTOMER_ID にMCC IDを設定するか、接続時にMCCで認可してください。');
    }
    const res = await this.call<{ resourceName?: string }>(`customers/${mcc}:createCustomerClient`, {
      method: 'POST',
      body: {
        customerClient: {
          descriptiveName: input.name,
          currencyCode: input.currencyCode ?? 'JPY',
          timeZone: input.timeZone ?? 'Asia/Tokyo',
        },
      },
    });
    const id = (res.resourceName ?? '').split('/').pop() ?? '';
    if (!id) {
      throw new AppError(HttpStatus.BAD_GATEWAY, 'アカウントを作成できませんでした。', 'MCCの権限とアクセスレベルを確認してください。');
    }
    return { externalAccountId: id, name: input.name };
  }

  /**
   * 検索キャンペーンを新規作成する (予算 → キャンペーン → 広告グループ → キーワード → 広告)。
   * **必ず一時停止(PAUSED)で作成する。**意図しない課金を防ぐため、配信開始は明示操作に分ける。
   */
  async createSearchCampaign(input: {
    customerId: string;
    campaignName: string;
    dailyBudgetYen: number;
    finalUrl: string;
    headlines: string[];
    descriptions: string[];
    keywords: string[];
    targetCpaYen?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<{ campaignId: string; adGroupId: string; keywordCount: number; status: 'PAUSED' }> {
    const cid = digitsOnly(input.customerId);
    const stamp = Date.now();

    // Google広告の見出しは30字、説明文は90字が上限 (全角も1字として数える)
    const headlines = input.headlines.map((h) => h.trim()).filter(Boolean).map((h) => h.slice(0, 30)).slice(0, 15);
    const descriptions = input.descriptions.map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, 90)).slice(0, 4);
    if (headlines.length < 3 || descriptions.length < 2) {
      throw new AppError(HttpStatus.BAD_REQUEST, '広告文が不足しています。',
        'Google広告のレスポンシブ検索広告には見出し3本以上・説明文2本以上が必要です。「③ 制作物」で広告文を追加してください。');
    }
    if (!/^https?:\/\//i.test(input.finalUrl)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'リンク先URLが未設定です。', '「③ 制作物」でLPのURLを設定してください。');
    }

    // 1) 予算
    const budgetRes = await this.call<{ results?: { resourceName: string }[] }>(`customers/${cid}/campaignBudgets:mutate`, {
      method: 'POST',
      body: {
        operations: [{
          create: {
            name: `${input.campaignName} 予算 ${stamp}`,
            amountMicros: toMicros(Math.max(input.dailyBudgetYen, 1)),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        }],
      },
    });
    const budgetName = budgetRes.results?.[0]?.resourceName;
    if (!budgetName) throw new AppError(HttpStatus.BAD_GATEWAY, '予算を作成できませんでした。', 'もう一度お試しください。');

    // 2) キャンペーン (必ず PAUSED。検索ネットワークのみでパートナー面は既定オフ)
    const campaign: Record<string, unknown> = {
      name: `${input.campaignName} ${stamp}`,
      status: 'PAUSED',
      advertisingChannelType: 'SEARCH',
      campaignBudget: budgetName,
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false,
        targetPartnerSearchNetwork: false,
      },
    };
    if (input.targetCpaYen && input.targetCpaYen > 0) {
      campaign.targetCpa = { targetCpaMicros: toMicros(input.targetCpaYen) };
    } else {
      campaign.maximizeConversions = {};
    }
    if (input.startDate) campaign.startDate = input.startDate.replace(/-/g, '');
    if (input.endDate) campaign.endDate = input.endDate.replace(/-/g, '');

    const campRes = await this.call<{ results?: { resourceName: string }[] }>(`customers/${cid}/campaigns:mutate`, {
      method: 'POST',
      body: { operations: [{ create: campaign }] },
    });
    const campaignName = campRes.results?.[0]?.resourceName;
    if (!campaignName) throw new AppError(HttpStatus.BAD_GATEWAY, 'キャンペーンを作成できませんでした。', 'もう一度お試しください。');
    const campaignId = campaignName.split('/').pop() ?? '';

    // 3) 広告グループ
    const agRes = await this.call<{ results?: { resourceName: string }[] }>(`customers/${cid}/adGroups:mutate`, {
      method: 'POST',
      body: {
        operations: [{
          create: { name: `${input.campaignName} 広告グループ`, campaign: campaignName, status: 'ENABLED', type: 'SEARCH_STANDARD' },
        }],
      },
    });
    const adGroupName = agRes.results?.[0]?.resourceName;
    if (!adGroupName) throw new AppError(HttpStatus.BAD_GATEWAY, '広告グループを作成できませんでした。', 'もう一度お試しください。');
    const adGroupId = adGroupName.split('/').pop() ?? '';

    // 4) キーワード (フレーズ一致。完全一致より機会損失が少なく、部分一致より無駄が少ない)
    const kws = [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 100);
    if (kws.length > 0) {
      await this.call(`customers/${cid}/adGroupCriteria:mutate`, {
        method: 'POST',
        body: {
          operations: kws.map((text) => ({
            create: { adGroup: adGroupName, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } },
          })),
        },
      });
    }

    // 5) レスポンシブ検索広告
    await this.call(`customers/${cid}/adGroupAds:mutate`, {
      method: 'POST',
      body: {
        operations: [{
          create: {
            adGroup: adGroupName,
            status: 'ENABLED',
            ad: {
              finalUrls: [input.finalUrl],
              responsiveSearchAd: {
                headlines: headlines.map((text) => ({ text })),
                descriptions: descriptions.map((text) => ({ text })),
              },
            },
          },
        }],
      },
    });

    return { campaignId, adGroupId, keywordCount: kws.length, status: 'PAUSED' };
  }

  /** 作成済みキャンペーンの配信を開始する (PAUSED → ENABLED)。課金が始まるため明示操作 */
  async enableCampaign(customerId: string, campaignId: string): Promise<void> {
    const cid = digitsOnly(customerId);
    await this.call(`customers/${cid}/campaigns:mutate`, {
      method: 'POST',
      body: {
        operations: [{
          update: { resourceName: `customers/${cid}/campaigns/${digitsOnly(campaignId)}`, status: 'ENABLED' },
          updateMask: 'status',
        }],
      },
    });
  }

  /** 接続の健全性を実APIで確認する (セットアップウィザードの前提チェック用) */
  async diagnose(): Promise<{ connected: boolean; accountCount: number; accounts: ExternalAccount[]; message: string }> {
    try {
      const accounts = await this.fetchAccounts('');
      return {
        connected: true,
        accountCount: accounts.length,
        accounts: accounts.slice(0, 50),
        message: accounts.length > 0
          ? `${accounts.length}件の広告アカウントを確認しました。`
          : 'MCC配下に広告アカウントがありません。アカウントを作成してください。',
      };
    } catch (e) {
      const err = e as AppError & { userMessage?: string };
      return { connected: false, accountCount: 0, accounts: [], message: err.message || '接続を確認できませんでした。' };
    }
  }
}
