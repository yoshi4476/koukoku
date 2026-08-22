import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AssetAdviceDto,
  AssetAdviceItem,
  AssetStatus,
  AssetType,
  AuditResult,
  ConnectionStatus,
  CreateAssetInput,
  CreateProjectInput,
  Platform,
  ProjectAccountDto,
  ProjectAssetDto,
  ProjectBrief,
  ProjectDetailDto,
  ProjectDto,
  ProjectGoal,
  ProjectSettings,
  ProjectStatus,
  UpdateAssetInput,
  UpdateProjectInput,
} from '@adgrid/shared';
import { DEFAULT_PROJECT_BRIEF, DEFAULT_PROJECT_SETTINGS, industryProfileFor } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MetricsService, daysAgo } from '../metrics/metrics.service';
import { AlertsService } from '../alerts/alerts.service';
import { scanLawDictionary } from '../ai/law-dictionary';
import { widthUnits } from '../ai/copy-limits';
import type { SessionInfoValue } from '../common/tenant';

const GOALS: ProjectGoal[] = ['conversion', 'awareness', 'traffic', 'store'];
const ASSET_TYPES: AssetType[] = ['copy', 'lp', 'flyer', 'video'];
const ASSET_STATUSES: AssetStatus[] = ['draft', 'review', 'approved', 'published'];

type AssetRow = {
  id: string; projectId: string; type: string; title: string; content: string;
  url: string; status: string; note: string; createdAt: Date; publishedAt: Date | null;
};
function toAssetDto(r: AssetRow): ProjectAssetDto {
  return {
    id: r.id, projectId: r.projectId, type: r.type as AssetType, title: r.title,
    content: r.content, url: r.url, status: r.status as AssetStatus, note: r.note,
    createdAt: r.createdAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
  ) {}

  private cpa(cost: number, conv: number): number | null {
    return conv > 0 ? Math.round(cost / conv) : null;
  }

  /** アカウント群の最新診断から未対応指摘数を数える */
  private async openFindingsFor(tx: Tx, accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0;
    const audits = await tx.audit.findMany({
      where: { adAccountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      take: accountIds.length * 3,
    });
    const seen = new Set<string>();
    let open = 0;
    for (const a of audits) {
      if (seen.has(a.adAccountId)) continue;
      seen.add(a.adAccountId);
      const statuses = (a.findingStatuses ?? {}) as Record<string, string>;
      for (const f of (a.result as unknown as AuditResult).findings ?? []) {
        if ((statuses[String(f.priority_rank)] ?? 'open') === 'open') open++;
      }
    }
    return open;
  }

  async list(tenantId: string): Promise<ProjectDto[]> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const projects = await tx.project.findMany({
        include: {
          client: true,
          adAccounts: { select: { id: true, platform: true } },
          assets: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const out: ProjectDto[] = [];
      for (const p of projects) {
        const accountIds = p.adAccounts.map((a) => a.id);
        const [cur, prev, lastReport, openFindings] = await Promise.all([
          this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(6), daysAgo(0)),
          this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(7)),
          tx.report.findFirst({ where: { clientId: p.clientId }, orderBy: { createdAt: 'desc' } }),
          this.openFindingsFor(tx, accountIds),
        ]);
        const cpa = this.cpa(cur.cost, cur.conversions);
        const prevCpa = prev.conversions > 0 ? prev.cost / prev.conversions : null;
        const acctSet = new Set(accountIds);
        out.push({
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: p.client.name,
          industryCode: p.client.industryCode,
          goal: p.goal as ProjectGoal,
          status: p.status as ProjectStatus,
          note: p.note,
          accountCount: accountIds.length,
          platforms: [...new Set(p.adAccounts.map((a) => a.platform))] as Platform[],
          cost7d: cur.cost,
          conversions7d: +cur.conversions.toFixed(1),
          cpa7d: cpa,
          cpaDelta: cpa !== null && prevCpa ? +(((cpa - prevCpa) / prevCpa) * 100).toFixed(1) : null,
          alertCount: events.filter((e) => acctSet.has(e.adAccountId)).length,
          openFindings,
          assetCount: p.assets.length,
          publishedCount: p.assets.filter((a) => a.status === 'published').length,
          lastReportAt: lastReport?.createdAt.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        });
      }
      return out;
    });
  }

  async detail(tenantId: string, id: string): Promise<ProjectDetailDto> {
    await this.alerts.ensureFreshDetection(tenantId).catch(() => undefined);
    const events = await this.alerts.unackedEvents(tenantId).catch(() => []);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.project.findUnique({
        where: { id },
        include: {
          client: true,
          adAccounts: { orderBy: { name: 'asc' } },
          assets: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!p) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const accountIds = p.adAccounts.map((a) => a.id);
      const connections = await tx.mediaConnection.findMany({});
      const connMap = new Map(connections.map((c) => [c.platform, c]));

      const [cur, prev, trend, lastReport, openFindings] = await Promise.all([
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(6), daysAgo(0)),
        this.metrics.totals(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(7)),
        this.metrics.dailyTrend(tx, { adAccountIds: accountIds }, daysAgo(13), daysAgo(0)),
        tx.report.findFirst({ where: { clientId: p.clientId }, orderBy: { createdAt: 'desc' } }),
        this.openFindingsFor(tx, accountIds),
      ]);

      const accounts: ProjectAccountDto[] = [];
      for (const a of p.adAccounts) {
        const t = await this.metrics.totals(tx, { adAccountId: a.id }, daysAgo(6), daysAgo(0));
        const conn = connMap.get(a.platform);
        accounts.push({
          adAccountId: a.id,
          name: a.name,
          platform: a.platform as Platform,
          connectionStatus: (conn?.status ?? 'not_connected') as ConnectionStatus,
          monthlyBudget: a.monthlyBudget ? Number(a.monthlyBudget) : null,
          cost7d: t.cost,
          conversions7d: +t.conversions.toFixed(1),
          cpa7d: this.cpa(t.cost, t.conversions),
        });
      }
      const acctSet = new Set(accountIds);

      return {
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.client.name,
        industryCode: p.client.industryCode,
        goal: p.goal as ProjectGoal,
        status: p.status as ProjectStatus,
        note: p.note,
        kpi: this.metrics.kpiFromTotals(cur, prev),
        trend,
        accounts,
        alerts: events.filter((e) => acctSet.has(e.adAccountId)),
        openFindings,
        assets: (p.assets as AssetRow[]).map(toAssetDto),
        settings: this.mergeSettings(p.settings),
        brief: this.mergeBrief(p.brief),
        lastReportAt: lastReport?.createdAt.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  /** 保存済みJSONを既定値とマージし、欠損なしの ProjectSettings にする */
  private mergeSettings(raw: unknown): ProjectSettings {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProjectSettings>;
    return { ...DEFAULT_PROJECT_SETTINGS, ...s };
  }

  private mergeBrief(raw: unknown): ProjectBrief {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProjectBrief>;
    return { ...DEFAULT_PROJECT_BRIEF, ...b };
  }

  /* ---------------- 制作物 (assets) ---------------- */

  async listAssets(tenantId: string, projectId: string): Promise<ProjectAssetDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.projectAsset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
    );
    return (rows as AssetRow[]).map(toAssetDto);
  }

  async createAsset(tenantId: string, projectId: string, input: CreateAssetInput): Promise<ProjectAssetDto> {
    if (!ASSET_TYPES.includes(input?.type)) {
      throw new AppError(HttpStatus.BAD_REQUEST, '制作物の種別が不正です。', '広告文・LP・チラシ・動画から選択してください。');
    }
    if (!input?.title?.trim()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'タイトルが未入力です。', 'タイトルを入力してください。');
    }
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      return tx.projectAsset.create({
        data: {
          tenantId,
          projectId,
          type: input.type,
          title: input.title.trim(),
          content: input.content ?? '',
          url: input.url ?? '',
          note: input.note ?? '',
        },
      });
    });
    return toAssetDto(row as AssetRow);
  }

  async updateAsset(tenantId: string, assetId: string, input: UpdateAssetInput): Promise<ProjectAssetDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const asset = await tx.projectAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      const data: Record<string, unknown> = {};
      if (typeof input.title === 'string' && input.title.trim()) data.title = input.title.trim();
      if (typeof input.content === 'string') data.content = input.content;
      if (typeof input.url === 'string') data.url = input.url;
      if (typeof input.note === 'string') data.note = input.note;
      if (input.status && ASSET_STATUSES.includes(input.status)) {
        data.status = input.status;
        // 公開/公開解除で publishedAt を整合させる
        if (input.status === 'published') data.publishedAt = new Date();
        else data.publishedAt = null;
      }
      return tx.projectAsset.update({ where: { id: assetId }, data });
    });
    return toAssetDto(row as AssetRow);
  }

  /** 制作物を公開する。承認者(owner/admin)かつ自社運用版のみ。掲載可否の最終操作 */
  async publishAsset(tenantId: string, assetId: string, user: SessionInfoValue): Promise<ProjectAssetDto> {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        '公開の権限がありません。',
        '公開はオーナーまたは管理者のみ実行できます。',
      );
    }
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { edition: true } });
      if (tenant?.edition === 'client') {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'この版では公開操作はできません。',
          '公開は運用担当(自社運用版)側で行われます。',
        );
      }
      const asset = await tx.projectAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      return tx.projectAsset.update({
        where: { id: assetId },
        data: { status: 'published', publishedAt: new Date() },
      });
    });
    return toAssetDto(row as AssetRow);
  }

  /** 制作物の改善ポイント (公開後の修正案)。業種相性・法規・種別別チェックで算出 */
  async adviceForAsset(tenantId: string, assetId: string): Promise<AssetAdviceDto> {
    const data = await this.prisma.withTenant(tenantId, async (tx) => {
      const asset = await tx.projectAsset.findUnique({
        where: { id: assetId },
        include: { project: { include: { client: true } } },
      });
      if (!asset) {
        throw new AppError(HttpStatus.NOT_FOUND, '制作物が見つかりません。', '再読み込みしてください。');
      }
      return asset;
    });
    const industry = data.project.client.industryCode;
    const profile = industryProfileFor(industry);
    const type = data.type as AssetType;
    const items: AssetAdviceItem[] = [];

    if (type === 'copy') {
      const text = `${data.title} ${data.content}`.trim();
      // 法規制チェック (業種NG含む)
      for (const w of scanLawDictionary(text)) {
        items.push({
          title: `表現の見直し: 「${w.expression}」`,
          detail: `${w.law}に触れるおそれ。${w.suggestion}`,
          severity: w.severity === 'block' ? 'warn' : 'tip',
        });
      }
      for (const ng of profile.ngWords) {
        if (text.includes(ng)) {
          items.push({ title: `${profile.label}で要注意の表現: 「${ng}」`, detail: '媒体審査で止まりやすい表現です。根拠明示か緩和を検討。', severity: 'warn' });
        }
      }
      // 文字数
      const units = widthUnits(data.content || data.title);
      if (units > 0 && units < 20) {
        items.push({ title: '情報量を増やす余地', detail: '説明文が短めです。ベネフィットや実績・数字を1つ加えると訴求力が上がります。', severity: 'tip' });
      }
      // 数字・CTA
      if (!/[0-9０-９]/.test(text)) {
        items.push({ title: '具体的な数字を入れる', detail: '「30%OFF」「導入3,000社」など数値があるとクリック率が上がりやすいです。', severity: 'tip' });
      }
      if (!/(無料|今すぐ|こちら|お試し|資料|予約|申込|購入|登録)/.test(text)) {
        items.push({ title: '行動を促す一言 (CTA) を追加', detail: `目的（${profile.cvLabel}）に合わせて「今すぐ${profile.cvLabel}」など次の行動を明示しましょう。`, severity: 'tip' });
      }
      // 業種の推奨訴求
      items.push({ title: '業種で効く訴求を試す', detail: `${profile.label}では ${profile.appealAxes.slice(0, 3).join('・')} が効きやすい傾向。別パターンをA/Bテストしましょう。`, severity: 'good' });
    } else if (type === 'lp') {
      items.push({ title: 'ファーストビューで結論', detail: '最初の画面で「誰の何が解決するか」と申込ボタンが見えるようにしましょう。', severity: 'tip' });
      items.push({ title: 'CTAボタンを複数配置', detail: 'ページ上部・中段・最下部にボタンを置くと離脱前に押されやすくなります。', severity: 'tip' });
      items.push({ title: 'スマホ表示と速度', detail: '画像を軽量化し、スマホで3秒以内に表示されるか確認を。表示が遅いと直帰します。', severity: 'warn' });
      items.push({ title: '入力フォームは最小限', detail: '項目数を減らすほどCVは上がります。不要な項目は削除・任意化を。', severity: 'tip' });
      items.push({ title: 'CV計測タグの設置確認', detail: '申込完了ページに計測タグが入っているか必ず確認。計測欠落は改善の致命傷です。', severity: 'warn' });
      items.push({ title: '信頼要素を追加', detail: '実績数・導入事例・口コミ・保証を載せると安心感が増します。', severity: 'good' });
    } else if (type === 'video') {
      items.push({ title: '冒頭2秒で掴む', detail: '最初の2秒で結論・驚き・ベネフィットを出すと離脱を防げます。', severity: 'tip' });
      items.push({ title: '字幕・テロップを入れる', detail: '多くの人が音声オフで見ます。字幕で内容が伝わるようにしましょう。', severity: 'warn' });
      items.push({ title: '縦型 (9:16) を用意', detail: 'リール/TikTok/ストーリーズ向けに縦型が有利です。', severity: 'tip' });
      items.push({ title: '15秒以内に短縮', detail: '短い動画ほど最後まで見られます。要点を絞りましょう。', severity: 'tip' });
      items.push({ title: '最後にロゴとCTA', detail: 'ブランドと次の行動（サイトへ/購入）を最後に明示しましょう。', severity: 'good' });
    } else {
      // flyer
      items.push({ title: '特典・オファーを大きく', detail: '割引や特典を一番目立たせると反応が上がります。', severity: 'tip' });
      items.push({ title: 'QRコード/URLを載せる', detail: '紙から誘導できるQRやURLを入れ、計測用パラメータも付けましょう。', severity: 'warn' });
      items.push({ title: '連絡先と有効期限', detail: '電話・住所・地図・特典の有効期限を明記すると信頼と緊急性が出ます。', severity: 'tip' });
      items.push({ title: '1枚1メッセージ', detail: '情報を詰め込みすぎず、伝えたいことを1つに絞ると伝わります。', severity: 'good' });
    }

    const summary =
      data.status === 'published'
        ? `公開中の${type === 'copy' ? '広告文' : type === 'lp' ? 'LP' : type === 'video' ? '動画' : 'チラシ'}です。次の改善で成果をさらに伸ばせます。`
        : '公開前にこのポイントを押さえておくと成果が出やすくなります。';

    return { assetId, type, summary, items };
  }

  async create(tenantId: string, input: CreateProjectInput): Promise<ProjectDto> {
    if (!input?.name?.trim() || !input?.clientId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'プロジェクト名またはクライアントが未指定です。',
        'プロジェクト名とクライアントを選択してください。',
      );
    }
    const goal: ProjectGoal = GOALS.includes(input.goal as ProjectGoal) ? (input.goal as ProjectGoal) : 'conversion';
    await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      const project = await tx.project.create({
        data: { tenantId, clientId: input.clientId, name: input.name.trim(), goal, note: input.note ?? '' },
      });
      if (input.accountIds?.length) {
        await tx.adAccount.updateMany({
          where: { id: { in: input.accountIds }, clientId: input.clientId },
          data: { projectId: project.id },
        });
      }
      return project;
    });
    const all = await this.list(tenantId);
    return all[0];
  }

  async update(tenantId: string, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const project = await tx.project.findUnique({ where: { id } });
      if (!project) {
        throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '一覧から選び直してください。');
      }
      const data: Record<string, unknown> = {};
      if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
      if (input.goal && GOALS.includes(input.goal)) data.goal = input.goal;
      if (input.status) data.status = input.status;
      if (typeof input.note === 'string') data.note = input.note;
      if (input.settings && typeof input.settings === 'object') {
        // 既存設定に部分更新をマージして保存
        data.settings = { ...this.mergeSettings(project.settings), ...input.settings } as object;
      }
      if (input.brief && typeof input.brief === 'object') {
        data.brief = { ...this.mergeBrief(project.brief), ...input.brief } as object;
      }
      if (Object.keys(data).length) await tx.project.update({ where: { id }, data });

      if (input.accountIds) {
        // 既存の紐付けを解除し、指定アカウントを再割当 (同一クライアント内のみ)
        await tx.adAccount.updateMany({ where: { projectId: id }, data: { projectId: null } });
        if (input.accountIds.length) {
          await tx.adAccount.updateMany({
            where: { id: { in: input.accountIds }, clientId: project.clientId },
            data: { projectId: id },
          });
        }
      }
    });
    const all = await this.list(tenantId);
    const found = all.find((p) => p.id === id);
    if (!found) throw new AppError(HttpStatus.NOT_FOUND, 'プロジェクトが見つかりません。', '再読み込みしてください。');
    return found;
  }
}
