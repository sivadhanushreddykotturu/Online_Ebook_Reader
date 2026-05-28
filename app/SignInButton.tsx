'use client';

import { signIn } from 'next-auth/react';

export default function SignInButton() {
  return (
    <button
      onClick={() => signIn('google')}
      style={{
        width: '100%',
        padding: '10px 16px',
        background: 'transparent',
        border: '1px solid #2f2f2f',
        color: '#ffffff',
        fontSize: '14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#202020';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      Sign in with Google
    </button>
  );
}
