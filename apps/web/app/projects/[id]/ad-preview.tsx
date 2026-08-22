'use client';

import type { Platform, ProjectAssetDto, ProjectDetailDto } from '@adgrid/shared';
import { BID_STRATEGY_LABEL } from '@adgrid/shared';
import { mediaUrl } from '@/lib/api';
import { PLATFORM_SHORT_LABEL } from '@/lib/labels';
import { formatYen } from '@/lib/format';
import { BannerStudio } from './banner-studio';

const CTA_BY_GOAL: Record<string, string> = {
  conversion: '今すぐ申込む', store: 'ご予約はこちら', traffic: '公式サイトへ', awareness: '詳しく見る',
};

const SEARCH_PLATFORMS: Platform[] = ['google_ads', 'yahoo_search', 'microsoft_ads'];
const FEED_PLATFORMS: Platform[] = [
  'meta', 'line_ads', 'tiktok', 'x_ads', 'pinterest', 'smartnews_ads', 'yahoo_display', 'criteo', 'amazon_ads',
];

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(url);
}

/** アップロード/外部URLのメディアを表示 (画像 or 動画) */
function MediaBox({ url, alt }: { url: string; alt: string }) {
  const src = mediaUrl(url);
  if (isVideoUrl(url)) {
    return <video className="adpv-media" src={src} controls preload="metadata" />;
  }
  return <img className="adpv-media" src={src} alt={alt} />;
}

/** 検索広告の表示イメージ (Google/Yahoo/Microsoft 風) */
function SearchAdPreview({ asset, site }: { asset: ProjectAssetDto; site: string }) {
  const headline = asset.title || '広告の見出しがここに表示されます';
  const desc = asset.content || '説明文がここに表示されます。ベネフィットや特典・行動喚起を簡潔に。';
  return (
    <div className="adpv adpv-search">
      <div className="adpv-cap">検索結果での見え方</div>
      <div className="sad-row">
        <span className="sad-badge">スポンサー</span>
        <span className="sad-url">{site}</span>
      </div>
      <div className="sad-title">{headline}</div>
      <div className="sad-desc">{desc}</div>
    </div>
  );
}

/** フィード/SNS広告の表示イメージ (Meta/LINE/TikTok 風) */
function FeedAdPreview({ asset, advertiser }: { asset: ProjectAssetDto; advertiser: string }) {
  const primary = asset.content || '本文（プライマリテキスト）がここに表示されます。';
  const headline = asset.title || '見出し';
  const hasMedia = !!asset.url;
  return (
    <div className="adpv adpv-feed">
      <div className="adpv-cap">フィード（SNS）での見え方</div>
      <div className="fad-head">
        <span className="fad-avatar" aria-hidden="true">{advertiser.slice(0, 1)}</span>
        <div className="fad-meta">
          <span className="fad-name">{advertiser}</span>
          <span className="fad-sub">広告 · PR</span>
        </div>
      </div>
      <div className="fad-primary">{primary}</div>
      {hasMedia ? <MediaBox url={asset.url} alt={headline} /> : <div className="adpv-media ph">画像 / 動画をアップロードするとここに表示されます</div>}
      <div className="fad-cta-row">
        <div className="fad-headline">{headline}</div>
        <button type="button" className="fad-cta" tabIndex={-1}>詳しくはこちら</button>
      </div>
    </div>
  );
}

/**
 * 制作物の「実際に広告が出る画面」プレビュー。媒体構成に応じて検索/フィードを出し分ける (F-24)。
 * copy=テキスト訴求の見え方、lp/flyer/video=アップロードした素材の見え方。
 */
export function AdPreview({ asset, project, showBanner = false }: { asset: ProjectAssetDto; project: ProjectDetailDto; showBanner?: boolean }) {
  const platforms = project.accounts.map((a) => a.platform);
  const advertiser = project.clientName || '広告主';
  const site = project.brief?.reference?.replace(/^https?:\/\//, '').split('/')[0] || 'example.com';
  const showSearch = asset.type === 'copy' && platforms.some((p) => SEARCH_PLATFORMS.includes(p));
  const showFeed =
    platforms.some((p) => FEED_PLATFORMS.includes(p)) || !!asset.url || asset.type !== 'copy' || !showSearch;
  const subLine = (asset.content || '').replace(/\n/g, ' ').split(/[。.!?！？]/)[0].trim();

  return (
    <div className="adpv-wrap">
      {showSearch ? <SearchAdPreview asset={asset} site={site} /> : null}
      {showFeed ? <FeedAdPreview asset={asset} advertiser={advertiser} /> : null}
      {showBanner ? (
        <div className="adpv">
          <div className="adpv-cap">自動バナー（ダウンロード可）</div>
          <BannerStudio
            headline={asset.title}
            sub={subLine}
            cta={CTA_BY_GOAL[project.goal] ?? '詳しくはこちら'}
            brand={advertiser}
            seed={project.industryCode}
          />
        </div>
      ) : null}
      <p className="adpv-note">※ 実際の表示は各媒体・デバイス・審査により異なります。イメージ確認用です。</p>
    </div>
  );
}

/* ---- 公開前の最終確認: 金額・ターゲティングを含む全設定を提示 ---- */

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="pcf-row">
      <span className="pcf-l">{label}</span>
      <span className={`pcf-v${warn ? ' warn' : ''}`}>{value}</span>
    </div>
  );
}

export function PublishConfirm({
  project,
  asset,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  project: ProjectDetailDto;
  asset: ProjectAssetDto;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const s = project.settings;
  const totalBudget = project.accounts.reduce((sum, a) => sum + (a.monthlyBudget ?? 0), 0);
  const gender = s.gender === 'all' ? '指定なし' : s.gender === 'male' ? '男性' : '女性';
  const device = s.devices === 'all' ? '全デバイス' : s.devices === 'mobile' ? 'モバイル' : 'PC';
  const period = s.startDate ? `${s.startDate} 〜 ${s.endDate ?? '無期限'}` : '即時開始・無期限';
  const budgetMissing = !s.monthlyBudgetTotal && totalBudget === 0;

  return (
    <div className="pcf">
      <p className="pcf-lead">
        以下の内容で <b>公開（配信対象）</b> になります。<mark>指定した金額・ターゲティングを必ずご確認ください。</mark>
      </p>

      <div className="pcf-sec">
        <div className="pcf-sec-h">この内容が配信されます</div>
        <AdPreview asset={asset} project={project} />
      </div>

      <div className="pcf-cols">
        <div className="pcf-sec">
          <div className="pcf-sec-h">💰 金額・入札</div>
          <Row label="月予算（設定）" value={s.monthlyBudgetTotal ? formatYen(s.monthlyBudgetTotal) : '未設定'} warn={!s.monthlyBudgetTotal} />
          <Row label="媒体別 月予算 合計" value={totalBudget > 0 ? formatYen(totalBudget) : '未設定'} warn={totalBudget === 0} />
          <Row label="日予算の目安" value={s.dailyBudget ? formatYen(s.dailyBudget) : '未設定'} />
          <Row label="入札戦略" value={BID_STRATEGY_LABEL[s.bidStrategy]} />
          <Row label="目標CPA" value={s.targetCpa ? formatYen(s.targetCpa) : '—'} />
          <Row label="目標ROAS" value={s.targetRoas ? `${s.targetRoas}%` : '—'} />
          <Row label="目標CV" value={s.targetCv ? `${s.targetCv}件/月` : '—'} />
        </div>
        <div className="pcf-sec">
          <div className="pcf-sec-h">🎯 ターゲティング・期間</div>
          <Row label="配信期間" value={period} />
          <Row label="地域" value={s.regions || '未設定'} />
          <Row label="年齢" value={s.ageRange || '指定なし'} />
          <Row label="性別" value={gender} />
          <Row label="デバイス" value={device} />
          <Row label="配信時間帯" value={s.dayparting || '終日'} />
          <Row label="計測するCV地点" value={s.conversionPoint || '未設定'} warn={!s.conversionPoint} />
        </div>
      </div>

      <div className="pcf-sec">
        <div className="pcf-sec-h">📺 配信先の媒体（{project.accounts.length}件）</div>
        {project.accounts.length === 0 ? (
          <p className="pcf-empty">媒体アカウントが紐づいていません。「掲示」タブで媒体を接続してください。</p>
        ) : (
          <div className="pcf-media-list">
            {project.accounts.map((a) => (
              <div key={a.adAccountId} className="pcf-media">
                <span className="pcf-media-name">{PLATFORM_SHORT_LABEL[a.platform]}・{a.name}</span>
                <span className="pcf-media-budget">{a.monthlyBudget ? formatYen(a.monthlyBudget) + '/月' : '予算未設定'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {budgetMissing || !s.conversionPoint ? (
        <div className="pcf-warn">
          ⚠️ {budgetMissing ? '予算が未設定です。' : ''}{!s.conversionPoint ? 'CV計測地点が未設定です。' : ''}
          「配信設定」タブで入力すると成果計測が正確になります（このまま公開も可能です）。
        </div>
      ) : null}

      {error ? <div className="pcf-err">{error}</div> : null}

      <div className="pcf-actions">
        <button type="button" className="btn sec" onClick={onCancel} disabled={busy}>キャンセル</button>
        <button type="button" className="btn pri" onClick={onConfirm} disabled={busy}>
          {busy ? '公開中…' : '🚀 この内容で公開する'}
        </button>
      </div>
    </div>
  );
}
