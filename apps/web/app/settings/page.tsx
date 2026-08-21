import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '設定' };

export default function SettingsPage() {
  return (
    <>
      <div className="page-h">
        <h1>設定</h1>
        <span className="sub">テナント情報とAPI接続の管理</span>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
        <div className="c-head"><h2>テナント情報</h2></div>
        <div className="c-body">
          <table className="data-tbl">
            <tbody>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>テナントID</td>
                <td style={{ textAlign: 'left' }} className="num">t_demo_agency</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>プラン</td>
                <td style={{ textAlign: 'left' }}>開発用デモ</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>認証</td>
                <td style={{ textAlign: 'left' }}>開発中は x-tenant-id ヘッダで指定 (Phase 2 でログイン実装)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="empty" style={{ maxWidth: 560 }}>
        <div className="e-title">API接続は Phase 2 で実装予定です</div>
        <div className="e-sub">各媒体とのOAuth接続・自動同期はここに追加されます。それまでの実績データはCSV取込をご利用ください。</div>
        <Link href="/import" className="btn pri">CSVを取り込む</Link>
      </div>
    </>
  );
}
