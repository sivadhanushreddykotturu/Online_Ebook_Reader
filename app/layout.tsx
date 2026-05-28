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
      </body>
    </html>
  );
}
