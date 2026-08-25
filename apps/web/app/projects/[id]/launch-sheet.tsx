'use client';

import { useEffect, useState } from 'react';
import type { LaunchSheetDto, Platform } from '@adgrid/shared';
import { PLATFORM_AD_SPECS, sheetToText } from '@adgrid/shared';
import { ErrorCard, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiGet, toApiError, type ApiError } from '@/lib/api';

/** 入稿シートを出せる媒体 (仕様を登録済みのもの) */
const SHEET_PLATFORMS = Object.keys(PLATFORM_AD_SPECS) as Platform[];

function copy(text: string, done: () => void) {
  navigator.clipboard?.writeText(text).then(done).catch(() => undefined);
}

/**
 * 媒体別 入稿シート (F-58)。
 * Google以外はAPI入稿ができない媒体もあるため、管理画面へ手入力する際に
 * 「その媒体の規定に合った最良の設定」をそのまま貼れる形で提示する。
 */
export function LaunchSheet({ projectId, platforms }: { projectId: string; platforms: Platform[] }) {
  // このプロジェクトが使う媒体を優先し、無ければ主要媒体を並べる
  const available = SHEET_PLATFORMS.filter((p) => platforms.includes(p));
  const list = available.length > 0 ? [...available, ...SHEET_PLATFORMS.filter((p) => !available.includes(p))] : SHEET_PLATFORMS;

  const [platform, setPlatform] = useState<Platform>(list[0]);
  const [sheet, setSheet] = useState<LaunchSheetDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setLoading(true); setError(null); setSheet(null);
    apiGet<LaunchSheetDto>(`/projects/${projectId}/launch-sheet?platform=${platform}`)
      .then(setSheet)
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setLoading(false));
  }, [projectId, platform]);

  const flash = (key: string) => { setCopied(key); setTimeout(() => setCopied(''), 1600); };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head">
        <h2>📋 媒体別 入稿シート</h2>
        {sheet ? (
          <span className={`pill ${sheet.ready ? 'up' : 'warn'}`} style={{ marginLeft: 'auto' }}>
            {sheet.ready ? '入稿できます' : `要修正 ${sheet.issues.length}件`}
          </span>
        ) : null}
      </div>
      <div className="c-body">
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          各媒体の<mark>文字数・本数・画像比率・ターゲティングの考え方</mark>に合わせて変換しました。
          管理画面にそのまま貼れば、手入力でも規定どおりに入稿できます。
        </p>

        <div className="ls-tabs">
          {list.map((p) => (
            <button
              key={p} type="button"
              className={`ls-tab${p === platform ? ' on' : ''}`}
              onClick={() => setPlatform(p)}
            >
              <PlatformTag platform={p} />
              {available.includes(p) ? <span className="ls-used">使用中</span> : null}
            </button>
          ))}
        </div>

        {error ? <ErrorCard error={error} /> : null}
        {loading ? <SkeletonLines count={5} /> : null}

        {sheet ? (
          <>
            <div className="ls-struct">構成: {sheet.structure}</div>

            {sheet.issues.length > 0 ? (
              <div className="launch-issues">
                <div className="li-h">入稿前に直す点</div>
                {sheet.issues.map((it, i) => <div className="li-item" key={i}>・{it}</div>)}
              </div>
            ) : null}

            <div className="ls-actions">
              <button type="button" className="btn sm pri" onClick={() => copy(sheetToText(sheet), () => flash('all'))}>
                {copied === 'all' ? 'コピーしました' : 'シート全体をコピー'}
              </button>
              <span className="deliver-hint">テキストで書き出します。そのまま担当者へ共有できます</span>
            </div>

            <div className="ls-sec">
              <div className="ls-h">設定</div>
              <div className="ls-fields">
                {sheet.settings.map((f, i) => (
                  <div className="ls-field" key={i}>
                    <span>{f.label}</span>
                    <b>{f.value}</b>
                    {f.note ? <small>{f.note}</small> : null}
                  </div>
                ))}
              </div>
            </div>

            {([
              ['見出し', sheet.headlines],
              ['本文', sheet.primaryTexts],
              ['説明文', sheet.descriptions],
            ] as const).map(([label, items]) => items.length > 0 ? (
              <div className="ls-sec" key={label}>
                <div className="ls-h">
                  {label}（{items.length}本）
                  <button type="button" className="ls-copy" onClick={() => copy(items.map((t) => t.text).join('\n'), () => flash(label))}>
                    {copied === label ? '✓' : 'コピー'}
                  </button>
                </div>
                {items.map((t, i) => (
                  <div className={`ls-row${t.ok ? '' : ' over'}`} key={i}>
                    <span className="ls-n">{i + 1}</span>
                    <span className="ls-txt">{t.text}</span>
                    <span className="ls-len">{t.len}字{t.ok ? '' : ' 超過'}</span>
                  </div>
                ))}
              </div>
            ) : null)}

            {sheet.keywords.length > 0 ? (
              <div className="ls-sec">
                <div className="ls-h">
                  キーワード（{sheet.keywords.length}語）
                  <button type="button" className="ls-copy" onClick={() => copy(sheet.keywords.join('\n'), () => flash('kw'))}>
                    {copied === 'kw' ? '✓' : 'コピー'}
                  </button>
                </div>
                <div className="ls-tags">{sheet.keywords.map((k, i) => <span className="tag" key={i}>{k}</span>)}</div>
              </div>
            ) : null}

            {sheet.negatives.length > 0 ? (
              <div className="ls-sec">
                <div className="ls-h">
                  除外キーワード（{sheet.negatives.length}語）
                  <button type="button" className="ls-copy" onClick={() => copy(sheet.negatives.join('\n'), () => flash('neg'))}>
                    {copied === 'neg' ? '✓' : 'コピー'}
                  </button>
                </div>
                <div className="ls-tags">{sheet.negatives.map((k, i) => <span className="tag" key={i}>{k}</span>)}</div>
              </div>
            ) : null}

            <div className="ls-sec">
              <div className="ls-h">ターゲティング</div>
              <ul className="ls-ul">{sheet.targeting.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>

            {sheet.images.length > 0 ? (
              <div className="ls-sec">
                <div className="ls-h">必要な画像</div>
                <div className="ls-imgs">
                  {sheet.images.map((im, i) => (
                    <div className="ls-img" key={i}>
                      <b>{im.label}</b>
                      <span className="num">{im.size}（{im.ratio}）</span>
                      <small>{im.note}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="ls-sec">
              <div className="ls-h">この媒体で成果を出す勘所</div>
              <ul className="ls-ul tips">{sheet.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>

            <div className="ls-sec">
              <div className="ls-h">入稿前チェック</div>
              <ul className="ls-check">{sheet.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
