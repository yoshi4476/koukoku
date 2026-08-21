'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { HintBar } from '@/components/ui';

/** 詳しい図解マニュアル (アーティファクト) */
const FULL_MANUAL_URL = 'https://claude.ai/code/artifact/c38311e8-b6f4-4170-aef4-eb5a04bfbe10';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="g-step">
      <div className="g-step-n">{n}</div>
      <div className="g-step-b">
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </div>
  );
}

function Section({
  no,
  href,
  title,
  lead,
  children,
}: {
  no: string;
  href?: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="g-sec">
      <div className="g-sec-head">
        <span className="g-sec-no">{no}</span>
        <h2>{title}</h2>
        {href ? (
          <Link href={href} className="btn sm sec" style={{ marginLeft: 'auto' }}>
            画面を開く
          </Link>
        ) : null}
      </div>
      <p className="g-sec-lead">{lead}</p>
      {children}
    </section>
  );
}

export default function GuidePage() {
  return (
    <>
      <div className="page-h">
        <h1>使い方ガイド</h1>
        <span className="sub">新機能の使い方を手順どおりにやさしく解説します</span>
      </div>

      <HintBar id="guide" title="このガイドについて">
        新機能は左メニューの<mark>「④ 直す（診断・改善）」→「キーワード最適化」</mark>、<mark>「設定」</mark>、<mark>「クライアント」</mark>の3か所にあります。難しい設定は不要。<b>画面の案内どおりにクリックするだけ</b>で使えます。
      </HintBar>

      <div className="g-banner">
        <div>
          <div className="g-banner-t">📘 詳しい図解マニュアル</div>
          <div className="g-banner-s">全機能の手順・図解・判定表・マーカー付き解説を別ページで開けます。</div>
        </div>
        <a className="btn pri" href={FULL_MANUAL_URL} target="_blank" rel="noopener noreferrer">
          図解マニュアルを開く ↗
        </a>
      </div>

      {/* 1. キーワード最適化 */}
      <Section
        no="01"
        href="/keywords"
        title="キーワード最適化"
        lead={<>キーワードを入れるだけで、<mark>どれを伸ばし・どれを削り・どれを止めるべきか</mark>をAIが自動で判定します。</>}
      >
        <div className="g-steps">
          <Step n={1} title="左メニューから「キーワード最適化」を開く">
            「④ 直す（診断・改善）」の中にあります。キーワード一覧と3つのランキングが表示されます。
          </Step>
          <Step n={2} title="上の3つのランキングで「勝ち筋」を確認">
            <mark>最高クリック率</mark>／<mark>バランス最良</mark>（費用対効果の総合点）／<mark>最高ROI</mark>。ここに出る言葉が伸ばす候補です。
          </Step>
          <Step n={3} title="表の行をクリックして推奨理由を見る">
            各行に判定バッジが付きます。クリックすると<mark>なぜそう判定したか</mark>と<mark>推奨の入札額</mark>まで開きます。
          </Step>
        </div>

        <div className="tbl-scroll" style={{ marginTop: 12 }}>
          <table className="data-tbl g-tbl">
            <thead>
              <tr>
                <th>判定</th>
                <th style={{ textAlign: 'left' }}>どんなキーワード？</th>
                <th style={{ textAlign: 'left' }}>おすすめアクション</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="pill up">▲ 増額</span></td>
                <td style={{ textAlign: 'left' }}>効率がよく、まだ表示の余地がある</td>
                <td style={{ textAlign: 'left' }}>入札を +25〜40% 上げて取りこぼしを減らす</td>
              </tr>
              <tr>
                <td><span className="pill flat">＝ 維持</span></td>
                <td style={{ textAlign: 'left' }}>効率は標準的、または判断材料が少ない</td>
                <td style={{ textAlign: 'left' }}>そのまま様子を見る</td>
              </tr>
              <tr>
                <td><span className="pill warn">▼ 減額</span></td>
                <td style={{ textAlign: 'left' }}>CPAが業種相場を大きく超過</td>
                <td style={{ textAlign: 'left' }}>入札を −35% 下げて赤字を圧縮</td>
              </tr>
              <tr>
                <td><span className="pill down">■ 停止</span></td>
                <td style={{ textAlign: 'left' }}>費用をかけているのに成果が0件</td>
                <td style={{ textAlign: 'left' }}>停止して予算を他へ回す</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 2. 承認申請 */}
      <Section
        no="02"
        href="/approvals"
        title="ワンクリック承認申請"
        lead={<>キーワードの推奨を、その場で<mark>承認キューへの申請</mark>に変えられます。「測る→AIが提案→承認→適用」が一本の流れに。</>}
      >
        <div className="g-flow">
          <span className="g-node">📈 測る</span>
          <span className="g-arw">→</span>
          <span className="g-node">🤖 AI提案</span>
          <span className="g-arw">→</span>
          <span className="g-node">✅ 承認</span>
          <span className="g-arw">→</span>
          <span className="g-node">🚀 適用・記録</span>
        </div>
        <div className="g-steps">
          <Step n={1} title="キーワードの行を開く">増額・減額・停止が推奨されている行を開きます（「維持」には申請ボタンは出ません）。</Step>
          <Step n={2} title="「この◯◯を承認申請」ボタンを押す">推奨内容がそのまま<mark>承認キュー</mark>に提案として起票されます。</Step>
          <Step n={3} title="承認キューで確認して承認">シミュレーションを見て承認。<mark>承認なしで広告が変わることはありません</mark>。</Step>
        </div>
        <p className="g-note">⚠️ 承認申請ボタンは<mark>自社運用版</mark>かつ<mark>オーナー / 管理者</mark>のときのみ表示されます。</p>
      </Section>

      {/* 3. 提供版切替 */}
      <Section
        no="03"
        href="/settings"
        title="提供版の切替（自社運用版 / 提供先版）"
        lead={<>1つのシステムのまま、<mark>社内で使う版</mark>と<mark>クライアントに渡す版</mark>を切り替えられます。</>}
      >
        <div className="g-cols">
          <div className="g-ed agency">
            <h4>🏢 自社運用版</h4>
            <ul>
              <li>複数クライアントの運用</li>
              <li>承認・自動適用（kill switch）</li>
              <li>媒体接続・課金・メンバー管理</li>
              <li>データ取込・勝ちパターン</li>
            </ul>
          </div>
          <div className="g-ed client">
            <h4>🤝 提供先版</h4>
            <ul>
              <li>自社の実績・診断・レポート閲覧</li>
              <li>キーワード最適化の閲覧</li>
              <li><b>承認・自動適用は非表示</b></li>
              <li><b>媒体接続・課金・取込は非表示</b></li>
            </ul>
          </div>
        </div>
        <div className="g-steps">
          <Step n={1} title="「設定」を開く">いちばん上の「提供版（エディション）」カードが版の切替です。</Step>
          <Step n={2} title="版のカードをクリックして選ぶ">切り替えると、メニューと操作が自動で切り替わります（オーナーのみ）。</Step>
        </div>
        <p className="g-note">🔒 提供先版では承認・自動適用が画面から消えるだけでなく、<mark>サーバ側でも操作を拒否</mark>します（二重防御）。</p>
      </Section>

      {/* 4. 業種モード */}
      <Section
        no="04"
        href="/clients"
        title="業種モード"
        lead={<>クライアントの業種に合わせて、<mark>相場・診断・広告文・用語</mark>の4つが自動で最適化されます。</>}
      >
        <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
          「クライアント」画面で各カードの業種タグ（例「EC・通販 業種モード ▾」）をクリックすると、その業種の最適化設定が表示されます。
        </p>
        <div className="tbl-scroll">
          <table className="data-tbl g-tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>項目</th>
                <th style={{ textAlign: 'left' }}>内容</th>
                <th style={{ textAlign: 'left' }}>例</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ textAlign: 'left' }}><b>相場・目標値</b></td><td style={{ textAlign: 'left' }}>業種のCTR/CVR/CPAを基準に診断・KW判定</td><td style={{ textAlign: 'left' }}>EC=CPA¥4,000 / SaaS=¥15,000</td></tr>
              <tr><td style={{ textAlign: 'left' }}><b>広告文の訴求</b></td><td style={{ textAlign: 'left' }}>効く訴求軸を優先、業種NG表現を警告</td><td style={{ textAlign: 'left' }}>美容=社会的証明 /「シミが消える」は薬機法警告</td></tr>
              <tr><td style={{ textAlign: 'left' }}><b>診断の重点</b></td><td style={{ textAlign: 'left' }}>業種で重要なカテゴリを上位に</td><td style={{ textAlign: 'left' }}>EC=クリエイティブ・入札 / SaaS=構成・計測</td></tr>
              <tr><td style={{ textAlign: 'left' }}><b>画面・用語</b></td><td style={{ textAlign: 'left' }}>CVの呼び方を業種に合わせる</td><td style={{ textAlign: 'left' }}>EC=購入 / 人材=応募 / 金融=申込・見積</td></tr>
            </tbody>
          </table>
        </div>
        <p className="g-note">💡 業種はクライアント登録時に自動で決まります。特別な設定は不要です。</p>
      </Section>
    </>
  );
}
