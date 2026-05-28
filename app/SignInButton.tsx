'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function SignInButton() {
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    setErrorMsg('');
    try {
      await signIn('google');
    } catch (err) {
      console.error(err);
      setLoadingGoogle(false);
    }
  };

  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please fill in all fields.');
      return;
    }
    if (!email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoadingCredentials(true);
    setErrorMsg('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        // Parse friendly errors from backend
        let friendlyMsg = 'Invalid email or password.';
        if (result.error.includes('Google')) {
          friendlyMsg = 'This email is registered with Google. Please Sign in with Google.';
        } else if (result.error.includes('Missing')) {
          friendlyMsg = 'Please enter both email and password.';
        }
        setErrorMsg(friendlyMsg);
        setLoadingCredentials(false);
      } else {
        // Successful login, redirect to dashboard
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Credentials sign in error:', err);
      setErrorMsg('An error occurred during sign in.');
      setLoadingCredentials(false);
    }
  };

  const isPending = loadingGoogle || loadingCredentials;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
      {/* Google Sign In */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isPending}
        style={{
          width: '100%',
          padding: '10px 16px',
          background: 'transparent',
          border: '1px solid #2f2f2f',
          color: '#ffffff',
          fontSize: '14px',
          cursor: isPending ? 'default' : 'pointer',
          fontFamily: 'inherit',
          transition: 'background 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          opacity: isPending ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isPending) e.currentTarget.style.background = '#202020';
        }}
        onMouseLeave={(e) => {
          if (!isPending) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span>Sign in with Google</span>
        {loadingGoogle && (
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
      </button>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0' }}>
        <div style={{ flex: 1, height: '1px', background: '#2f2f2f' }} />
        <span style={{ padding: '0 12px', color: '#666', fontSize: '12px' }}>or</span>
        <div style={{ flex: 1, height: '1px', background: '#2f2f2f' }} />
      </div>

      {/* Credentials Form */}
      <form onSubmit={handleCredentialsSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="email" style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Gmail / Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            style={{
              background: '#151515',
              border: '1px solid #2f2f2f',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '10px 12px',
              fontSize: '14px',
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box',
              width: '100%',
            }}
            onFocus={(e) => e.target.style.borderColor = '#555555'}
            onBlur={(e) => e.target.style.borderColor = '#2f2f2f'}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="password" style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isPending}
            style={{
              background: '#151515',
              border: '1px solid #2f2f2f',
              borderRadius: '4px',
              color: '#ffffff',
              padding: '10px 12px',
              fontSize: '14px',
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box',
              width: '100%',
            }}
            onFocus={(e) => e.target.style.borderColor = '#555555'}
            onBlur={(e) => e.target.style.borderColor = '#2f2f2f'}
          />
        </div>

        {errorMsg && (
          <div style={{ color: '#ff5555', fontSize: '13px', marginTop: '4px' }}>
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          style={{
            marginTop: '8px',
            width: '100%',
            padding: '10px 16px',
            background: '#ffffff',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            color: '#000000',
            fontSize: '14px',
            fontWeight: 500,
            cursor: isPending ? 'default' : 'pointer',
            fontFamily: 'inherit',
            transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            opacity: isPending ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isPending) {
              e.currentTarget.style.background = '#e5e5e5';
              e.currentTarget.style.borderColor = '#e5e5e5';
            }
          }}
          onMouseLeave={(e) => {
            if (!isPending) {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#ffffff';
            }
          }}
        >
          <span>Sign In / Register</span>
          {loadingCredentials && (
            <span
              style={{
                width: '14px',
                height: '14px',
                border: '2px solid #00000030',
                borderTopColor: '#000000',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
          )}
        </button>
      </form>
      
      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
