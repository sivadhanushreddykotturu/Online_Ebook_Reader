'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';

interface UserMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export default function UserMenu({ user }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>(
    user.image || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || 'User')}`
  );
  const [isChangingAvatar, setIsChangingAvatar] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync avatar from DB on mount
  useEffect(() => {
    fetch('/api/user/profile')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch profile');
      })
      .then((data) => {
        if (data.image) {
          setAvatarUrl(data.image);
        }
      })
      .catch((err) => {
        console.warn('Could not sync user profile image from DB:', err);
      });
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChangeAvatar = async () => {
    setIsChangingAvatar(true);
    try {
      const res = await fetch('/api/user/change-avatar', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.image) {
          setAvatarUrl(data.image);
        }
      } else {
        alert('Failed to update avatar. Please try again.');
      }
    } catch (err) {
      console.error('Error changing avatar:', err);
      alert('Network error updating avatar.');
    } finally {
      setIsChangingAvatar(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut({ callbackUrl: '/' });
    } catch (err) {
      console.error('Error signing out:', err);
      setIsSigningOut(false);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          borderRadius: '50%',
          overflow: 'hidden',
          width: '28px',
          height: '28px',
          outline: 'none',
        }}
      >
        <img
          src={avatarUrl}
          alt={user.name || 'User avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            marginTop: '8px',
            background: '#202020',
            border: '1px solid #2f2f2f',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            zIndex: 100,
            minWidth: '150px',
            padding: '4px 0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Change Avatar Button */}
          <button
            onClick={handleChangeAvatar}
            disabled={isChangingAvatar || isSigningOut}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: '#ffffff',
              padding: '8px 12px',
              fontSize: '13px',
              fontFamily: 'inherit',
              cursor: isChangingAvatar || isSigningOut ? 'default' : 'pointer',
              transition: 'background 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              opacity: isChangingAvatar || isSigningOut ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isChangingAvatar && !isSigningOut) e.currentTarget.style.background = '#2f2f2f';
            }}
            onMouseLeave={(e) => {
              if (!isChangingAvatar && !isSigningOut) e.currentTarget.style.background = 'none';
            }}
          >
            <span>Change Avatar</span>
            {isChangingAvatar && (
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  border: '2px solid #ffffff30',
                  borderTopColor: '#ffffff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
          </button>

          {/* Sign Out Button */}
          <button
            onClick={handleSignOut}
            disabled={isChangingAvatar || isSigningOut}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: '#ffffff',
              padding: '8px 12px',
              fontSize: '13px',
              fontFamily: 'inherit',
              cursor: isChangingAvatar || isSigningOut ? 'default' : 'pointer',
              transition: 'background 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              opacity: isChangingAvatar || isSigningOut ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isChangingAvatar && !isSigningOut) e.currentTarget.style.background = '#2f2f2f';
            }}
            onMouseLeave={(e) => {
              if (!isChangingAvatar && !isSigningOut) e.currentTarget.style.background = 'none';
            }}
          >
            <span>Sign out</span>
            {isSigningOut && (
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  border: '2px solid #ffffff30',
                  borderTopColor: '#ffffff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
