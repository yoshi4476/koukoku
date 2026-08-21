import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import { ClientProvider } from '@/components/client-context';
import { Shell } from '@/components/shell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'ADGRID', template: '%s | ADGRID' },
  description: '広告運用の司令室 — 統合ダッシュボード・AI診断・レポート自動化',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJp.variable}`}>
      <body>
        <ClientProvider>
          <Shell>{children}</Shell>
        </ClientProvider>
      </body>
    </html>
  );
}
