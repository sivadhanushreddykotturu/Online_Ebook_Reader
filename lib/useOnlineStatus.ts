'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook to detect online/offline status.
 * Returns { isOnline, wasOffline } and calls onReconnect callback
 * when transitioning from offline → online.
 */
export function useOnlineStatus(onReconnect?: () => void) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    setWasOffline(true);
    // Clear the "was offline" toast after 3 seconds
    setTimeout(() => setWasOffline(false), 3000);
    onReconnectRef.current?.();
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setWasOffline(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return { isOnline, wasOffline };
}
