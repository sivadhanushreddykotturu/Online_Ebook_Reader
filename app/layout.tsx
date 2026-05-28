import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { auth } from '@/lib/auth';
import UserMenu from './UserMenu';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PDF Reader',
  description: 'A minimal PDF reader application',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en" className={inter.className}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#191919" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-180x180.png" />
      </head>
      <body
        style={{
          background: '#191919',
          color: '#ffffff',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 24px',
            borderBottom: '1px solid #2f2f2f',
            height: '52px',
            background: '#191919',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
          }}
        >
          <div style={{ fontSize: '14px', color: '#ffffff', userSelect: 'none' }}>
            PDF Reader
          </div>
          {session?.user && <UserMenu user={session.user} />}
        </header>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(reg) { console.log('SW success:', reg.scope); },
                    function(err) { console.log('SW fail:', err); }
                  );
                });
              }
            `
          }}
        />
      </body>
    </html>
  );
}
