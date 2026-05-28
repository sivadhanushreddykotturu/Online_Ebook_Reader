'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function SignInButton() {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn('google');
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleSignIn}
      disabled={loading}
      style={{
        width: '100%',
        padding: '10px 16px',
        background: 'transparent',
        border: '1px solid #2f2f2f',
        color: '#ffffff',
        fontSize: '14px',
        cursor: loading ? 'default' : 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!loading) e.currentTarget.style.background = '#202020';
      }}
      onMouseLeave={(e) => {
        if (!loading) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span>Sign in with Google</span>
      {loading && (
        <span
          style={{
            width: '14px',
            height: '14px',
            border: '2px solid #ffffff30',
            borderTopColor: '#ffffff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
      )}
      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}
