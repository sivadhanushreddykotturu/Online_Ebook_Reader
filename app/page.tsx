import { auth } from '@/lib/auth';
import LibraryDashboard from './LibraryDashboard';
import SignInButton from './SignInButton';

export default async function Page() {
  const session = await auth();

  if (!session) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        background: '#191919',
        color: '#ffffff',
        padding: '24px',
      }}>
        <div style={{ maxWidth: '320px', width: '100%', textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 400, marginBottom: '8px' }}>PDF Reader</h2>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '24px' }}>
            A minimal tool to read PDFs and track your progress.
          </p>
          <SignInButton />
        </div>
      </div>
    );
  }

  return <LibraryDashboard />;
}
