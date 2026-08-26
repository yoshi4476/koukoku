'use client';

import { useMemo, useState } from 'react';
import type { Platform } from '@adgrid/shared';
import { buildUtmUrl, campaignName, checkUtmConsistency } from '@adgrid/shared';
import { PLATFORM_SHORT_LABEL } from '@/lib/labels';

function CopyBtn({ value }: { value: string }) {
  const [c, setC] = useState(false);
  return (
    <button className="btn sm sec" onClick={() => navigator.clipboard?.writeText(value).then(() => { setC(true); setTimeout(() => setC(false), 1200); }, () => undefined)}>
      {c ? '✓' : 'コピー'}
    </button>
  );
}

/**
 * UTM・命名規則ジェネレータ + 一貫性チェック (F-38)。
 * 媒体ごとに標準化した計測URL・キャンペーン名を生成し、貼られたURLの表記ゆれを検査する。
 */
export function UtmTool({
  clientName, projectName, platforms,
}: { clientName: string; projectName: string; platforms: Platform[] }) {
  const [baseUrl, setBaseUrl] = useState('https://example.com/lp');
  const [content, setContent] = useState('');
  const [check, setCheck] = useState('');
  const yyyymm = useMemo(() => {
    // 当月 (YYYYMM)。決定的でなくてよい表示用
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  // 媒体で重複排除する。同一媒体の複数アカウントがあると platforms が重複し、
  // key={p} が衝突して行が二重表示され、CopyBtn の「✓」状態も混線する
  const rows = [...new Set(platforms.length ? platforms : (['google_ads', 'meta'] as Platform[]))];
  const result = check.trim() ? checkUtmConsistency(check) : null;

  return (
    <div className="utm">
      <div className="utm-head"><span className="utm-title">🔗 UTM・命名規則</span></div>
      <div className="utm-inputs">
        <label className="kpit-field" style={{ flex: 2 }}><span>リンク先URL</span>
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" /></label>
        <label className="kpit-field"><span>クリエイティブ識別 (utm_content・任意)</span>
          <input className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="例: banner-a" /></label>
      </div>

      <div className="utm-rows">
        {rows.map((p) => {
          const camp = campaignName(clientName, projectName, p, yyyymm);
          const url = buildUtmUrl(baseUrl, p, camp, content);
          return (
            <div key={p} className="utm-row">
              <div className="utm-plat">{PLATFORM_SHORT_LABEL[p]}</div>
              <div className="utm-vals">
                <div className="utm-line"><span className="utm-k">キャンペーン名</span><code>{camp}</code><CopyBtn value={camp} /></div>
                <div className="utm-line"><span className="utm-k">計測URL</span><code className="utm-url">{url}</code><CopyBtn value={url} /></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="utm-check">
        <div className="utm-check-h">貼り付けたURLの一貫性チェック</div>
        <input className="input" value={check} onChange={(e) => setCheck(e.target.value)} placeholder="計測URLを貼るとエラー・表記ゆれを検査します" />
        {result ? (
          result.issues.length === 0 ? (
            <div className="utm-ok">✓ 問題ありません。標準表記に沿っています。</div>
          ) : (
            <ul className="utm-issues">
              {result.issues.map((i, idx) => (
                <li key={idx} className={i.level}>{i.level === 'error' ? '⛔' : '⚠️'} {i.message}</li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      <p className="kpit-note">※ source/medium/campaign を小文字・ハイフンで統一すると、GA4等で計測が分断されません。</p>
    </div>
  );
}
