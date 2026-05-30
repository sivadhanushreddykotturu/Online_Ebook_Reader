'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCachedPdf, cachePdf } from '@/lib/pdfCache';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import {
  getCachedBookmarks,
  setCachedBookmarks,
  addCachedBookmark,
  removeCachedBookmark,
  getPendingSyncBookmarks,
  clearPendingSyncFlags,
  CachedBookmark,
} from '@/lib/bookmarkCache';

interface Book {
  _id: string;
  r2Key: string;
  title: string;
  currentPage: number;
  totalPages: number;
}

interface PDFDocumentProxy {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
}

interface PDFPageProxy {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    transform?: number[];
  }) => PDFRenderTask;
  getTextContent: () => Promise<unknown>;
}

interface PDFRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export default function ReaderComponent({ initialBook }: { initialBook: Book }) {
  const router = useRouter();
  const { isOnline, wasOffline } = useOnlineStatus();
  const [book] = useState<Book>(initialBook);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const queryPage = searchParams.get('page');
      if (queryPage) {
        const parsed = parseInt(queryPage, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          return parsed;
        }
      }
      const localSaved = localStorage.getItem(`book-progress-${initialBook._id}`);
      if (localSaved) {
        return parseInt(localSaved, 10);
      }
    }
    return initialBook.currentPage || 1;
  });
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading PDF...');
  const [renderingPage, setRenderingPage] = useState(false);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [inputPageVal, setInputPageVal] = useState('');
  const [customAlert, setCustomAlert] = useState<{ message: string; title?: string } | null>(null);

  // Bookmarks States
  const [mounted, setMounted] = useState(false);
  const [bookmarks, setBookmarks] = useState<CachedBookmark[]>([]);
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);
  const [showBookmarkPopup, setShowBookmarkPopup] = useState<number | null>(null);
  const [bookmarkNote, setBookmarkNote] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<PDFRenderTask | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartMidYViewportRef = useRef<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState<number>(1.0);
  const [viewMode, setViewMode] = useState<'single' | 'split' | 'scroll'>('single');
  const [splitSide, setSplitSide] = useState<'left' | 'right'>('left');
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(1.4);
  const nextPageRef = useRef<PDFPageProxy | null>(null);
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1.0);
  const lastTapTimeRef = useRef<number>(0);
  const gestureZoomRef = useRef<number | null>(null);
  const zoomTargetRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [windowWidth, setWindowWidth] = useState(800);
  const visiblePagesRef = useRef<Set<number>>(new Set());

  // Sync bookmarks from/to server and cache
  const syncBookmarks = useCallback(async () => {
    if (!book) return;
    try {
      // 1. If online, flush any pending syncs first
      if (navigator.onLine) {
        const pending = await getPendingSyncBookmarks(book._id);
        if (pending.length > 0) {
          for (const item of pending) {
            if (item.pendingSync === 'add') {
              await fetch(`/api/books/${book._id}/bookmarks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageNumber: item.pageNumber, note: item.note }),
              });
            } else if (item.pendingSync === 'delete') {
              await fetch(`/api/books/${book._id}/bookmarks`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageNumber: item.pageNumber }),
              });
            }
          }
          await clearPendingSyncFlags(book._id);
        }
      }

      // 2. Fetch fresh bookmarks from server (if online) and cache them
      if (navigator.onLine) {
        const res = await fetch(`/api/books/${book._id}/bookmarks`);
        if (res.ok) {
          const serverBookmarks: CachedBookmark[] = await res.json();
          await setCachedBookmarks(book._id, serverBookmarks);
          setBookmarks(serverBookmarks);
          return;
        }
      }

      // 3. Fallback to cached bookmarks if offline or server fetch failed
      const cached = await getCachedBookmarks(book._id);
      // Filter out any bookmarks pending delete locally
      const visible = cached.filter((b) => b.pendingSync !== 'delete');
      setBookmarks(visible);
    } catch (err) {
      console.warn('[ReaderComponent] Failed to sync bookmarks:', err);
      const cached = await getCachedBookmarks(book._id);
      const visible = cached.filter((b) => b.pendingSync !== 'delete');
      setBookmarks(visible);
    }
  }, [book]);

  useEffect(() => {
    syncBookmarks();
  }, [syncBookmarks, isOnline]);

  useEffect(() => {
    if (isOnline && book) {
      // Re-sync progress to server immediately when back online
      fetch('/api/books/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          r2Key: book.r2Key,
          currentPage: pageNumber,
          totalPages: numPages || book.totalPages || 0,
        }),
      }).catch((err) => console.warn('Failed to sync progress on reconnect:', err));
    }
  }, [isOnline, book]);

  const handleToggleBookmarkClick = () => {
    const existing = bookmarks.find((b) => b.pageNumber === pageNumber);
    if (existing) {
      setBookmarkNote(existing.note || '');
      setShowBookmarkPopup(pageNumber);
    } else {
      setBookmarkNote('');
      setShowBookmarkPopup(pageNumber);
    }
  };

  const handleSaveBookmark = async () => {
    if (!book) return;
    const newBookmark: CachedBookmark = {
      bookId: book._id,
      pageNumber,
      note: bookmarkNote,
      createdAt: new Date().toISOString(),
    };

    try {
      if (navigator.onLine) {
        const res = await fetch(`/api/books/${book._id}/bookmarks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageNumber, note: bookmarkNote }),
        });
        if (res.ok) {
          const saved = await res.json();
          await addCachedBookmark(book._id, saved);
        } else {
          newBookmark.pendingSync = 'add';
          await addCachedBookmark(book._id, newBookmark);
        }
      } else {
        newBookmark.pendingSync = 'add';
        await addCachedBookmark(book._id, newBookmark);
      }
    } catch {
      newBookmark.pendingSync = 'add';
      await addCachedBookmark(book._id, newBookmark);
    }

    await syncBookmarks();
    setShowBookmarkPopup(null);
  };

  const handleDeleteBookmark = async (pageNumToDelete: number) => {
    if (!book) return;
    try {
      if (navigator.onLine) {
        const res = await fetch(`/api/books/${book._id}/bookmarks`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageNumber: pageNumToDelete }),
        });
        if (res.ok) {
          await removeCachedBookmark(book._id, pageNumToDelete);
        } else {
          const cached = await getCachedBookmarks(book._id);
          const found = cached.find((b) => b.pageNumber === pageNumToDelete);
          if (found) {
            if (found.pendingSync === 'add') {
              await removeCachedBookmark(book._id, pageNumToDelete);
            } else {
              found.pendingSync = 'delete';
              await addCachedBookmark(book._id, found);
            }
          }
        }
      } else {
        const cached = await getCachedBookmarks(book._id);
        const found = cached.find((b) => b.pageNumber === pageNumToDelete);
        if (found) {
          if (found.pendingSync === 'add') {
            await removeCachedBookmark(book._id, pageNumToDelete);
          } else {
            found.pendingSync = 'delete';
            await addCachedBookmark(book._id, found);
          }
        }
      }
    } catch {
      const cached = await getCachedBookmarks(book._id);
      const found = cached.find((b) => b.pageNumber === pageNumToDelete);
      if (found) {
        if (found.pendingSync === 'add') {
          await removeCachedBookmark(book._id, pageNumToDelete);
        } else {
          found.pendingSync = 'delete';
          await addCachedBookmark(book._id, found);
        }
      }
    }

    await syncBookmarks();
    setShowBookmarkPopup(null);
  };

  useEffect(() => {
    setMounted(true);
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
      setWindowWidth(window.innerWidth);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, []);

  useEffect(() => {
    if (!book) return;

    let active = true;
    const abortController = new AbortController();

    async function loadPDF() {
      try {
        const pdfjs = (window as unknown as {
          pdfjsLib?: {
            GlobalWorkerOptions: { workerSrc: string };
            getDocument: (source: string | { data: Uint8Array }) => { promise: Promise<PDFDocumentProxy> };
            renderTextLayer: (params: unknown) => { promise: Promise<void> };
          };
        }).pdfjsLib;
        if (!pdfjs) {
          throw new Error('PDF.js not loaded. Check script injection.');
        }
        pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.min.js';

        let pdfSource: string | { data: Uint8Array };
        const cached = await getCachedPdf(book.r2Key);

        if (cached) {
          setLoadingMsg('Loading PDF...');
          pdfSource = { data: new Uint8Array(cached) };
        } else {
          setLoadingMsg('Downloading PDF... (First-time load may take a moment)');
          const pdfRes = await fetch(`/api/pdf/${book._id}`, {
            signal: abortController.signal,
          });
          if (!pdfRes.ok) throw new Error('Failed to download PDF');
          const buffer = await pdfRes.arrayBuffer();

          cachePdf(book.r2Key, buffer).catch(() => {});

          pdfSource = { data: new Uint8Array(buffer) };
          setLoadingMsg('Loading PDF...');
        }

        const loadingTask = pdfjs.getDocument(pdfSource);
        const pdf = await loadingTask.promise;

        if (active) {
          setPdfDoc(pdf);
          setNumPages(pdf.numPages);
          setLoading(false);
        }
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        if (!isAbort) {
          console.error('Error loading PDF:', err);
        }
        if (active && !isAbort) {
          const msg = err instanceof Error ? err.message : String(err);
          setCustomAlert({
            title: 'Failed to load PDF',
            message: `Failed to load PDF document: ${msg}. Check browser console for more details.`,
          });
        }
      }
    }

    loadPDF();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [book, router]);

  useEffect(() => {
    if (!pdfDoc) return;
    let active = true;
    pdfDoc.getPage(1).then((page) => {
      if (active) {
        const viewport = page.getViewport({ scale: 1 });
        setPageAspectRatio(viewport.height / viewport.width);
      }
    }).catch((err) => {
      console.error('Error getting page aspect ratio:', err);
    });
    return () => {
      active = false;
    };
  }, [pdfDoc]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || viewMode === 'scroll') return;

    let active = true;
    const doc = pdfDoc;

    async function renderPages() {
      try {
        setRenderingPage(true);

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page1 = await doc.getPage(pageNumber);
        if (!active) return;

        const canvas1 = canvasRef.current;
        const context1 = canvas1?.getContext('2d');

        if (canvas1 && context1) {
          const containerWidth = Math.min(windowWidth - 32, 800) * zoom;
          const desiredWidth = viewMode === 'split' ? containerWidth * 2 : containerWidth;
          const unscaledViewport = page1.getViewport({ scale: 1 });
          const outputScale = Math.min(Math.max((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2.0), 3.0);
          const scale = (desiredWidth / unscaledViewport.width) * outputScale;
          const viewport1 = page1.getViewport({ scale });

          canvas1.width = Math.floor(viewport1.width);
          canvas1.height = Math.floor(viewport1.height);

          const renderContext1 = {
            canvasContext: context1,
            viewport: viewport1,
          };

          const renderTask1 = page1.render(renderContext1);
          renderTaskRef.current = renderTask1;
          await renderTask1.promise;

          // Render text selection layer
          if (active && textLayerRef.current) {
            const pdfjs = (window as unknown as { pdfjsLib?: { renderTextLayer: (params: unknown) => { promise: Promise<void> } } }).pdfjsLib;
            if (pdfjs?.renderTextLayer) {
              const textLayerDiv = textLayerRef.current;
              textLayerDiv.innerHTML = '';
              // CSS layout size
              const cssWidth = viewMode === 'split' ? containerWidth * 2 : containerWidth;
              const cssHeight = cssWidth * (viewport1.height / viewport1.width);
              textLayerDiv.style.width = `${cssWidth}px`;
              textLayerDiv.style.height = `${cssHeight}px`;
              const cssViewport = page1.getViewport({ scale: desiredWidth / unscaledViewport.width });
              const textContent = await page1.getTextContent();
              pdfjs.renderTextLayer({
                textContentSource: textContent,
                container: textLayerDiv,
                viewport: cssViewport,
              });
            }
          }
        }
      } catch (err) {
        const errorName = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
        if (errorName !== 'RenderingCancelledException') {
          console.error('Page rendering error:', err);
        }
      } finally {
        if (active) {
          setRenderingPage(false);
        }
      }
    }

    renderPages();

    return () => {
      active = false;
    };
  }, [pageNumber, pdfDoc, zoom, viewMode, splitSide, windowWidth]);

  useEffect(() => {
    if (!book || loading) return;

    const fileKey = book.r2Key;
    const initialTotal = book.totalPages || 0;

    // Save to local storage instantly (never loses progress on this device)
    localStorage.setItem(`book-progress-${book._id}`, pageNumber.toString());

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        await fetch('/api/books/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            r2Key: fileKey,
            currentPage: pageNumber,
            totalPages: numPages || initialTotal,
          }),
        });
      } catch (err) {
        console.error('Failed to sync progress:', err);
      }
    }, 2000);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [pageNumber, book, numPages, loading]);

  // Sync page index from server in the background when app becomes visible or focused
  useEffect(() => {
    if (!book) return;

    const syncPageOnResume = async () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          const res = await fetch(`/api/books/${book._id}`);
          if (res.ok) {
            const latestBook = await res.json();
            if (latestBook && typeof latestBook.currentPage === 'number') {
              setPageNumber((current) => {
                if (current < latestBook.currentPage) {
                  localStorage.setItem(`book-progress-${book._id}`, latestBook.currentPage.toString());
                  return latestBook.currentPage;
                } else if (current > latestBook.currentPage) {
                  // Server is stale (local is newer, e.g. read offline), sync local to server
                  fetch('/api/books/progress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      r2Key: book.r2Key,
                      currentPage: current,
                      totalPages: numPages || book.totalPages || 0,
                    }),
                  }).catch(() => {});
                }
                return current;
              });
            }
          }
        } catch (err) {
          console.warn('Failed to sync reader progress from server on resume:', err);
        }
      }
    };

    document.addEventListener('visibilitychange', syncPageOnResume);
    window.addEventListener('focus', syncPageOnResume);
    
    // Also perform a background check once on mount (in case initial state loaded is cached)
    syncPageOnResume();

    return () => {
      document.removeEventListener('visibilitychange', syncPageOnResume);
      window.removeEventListener('focus', syncPageOnResume);
    };
  }, [book, numPages]);

  useEffect(() => {
    if (!pdfDoc || pageNumber >= (numPages || 0)) return;

    let active = true;
    const nextPageNum = pageNumber + 1;
    if (nextPageNum <= (numPages || 0)) {
      pdfDoc.getPage(nextPageNum).then((page) => {
        if (active) {
          nextPageRef.current = page;
        }
      }).catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [pageNumber, pdfDoc, numPages]);

  const scrollToPage = (pageNum: number) => {
    const el = document.getElementById(`scroll-page-${pageNum}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (!loading && viewMode === 'scroll') {
      const timer = setTimeout(() => {
        scrollToPage(pageNumber);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, viewMode, pageNumber]);

  const handlePrevPage = useCallback(() => {
    if (viewMode === 'scroll') {
      const target = Math.max(pageNumber - 1, 1);
      setPageNumber(target);
      scrollToPage(target);
    } else if (viewMode === 'split') {
      if (splitSide === 'right') {
        setSplitSide('left');
      } else {
        if (pageNumber > 1) {
          setPageNumber((prev) => prev - 1);
          setSplitSide('right');
        }
      }
    } else {
      setPageNumber((prev) => Math.max(prev - 1, 1));
    }
  }, [viewMode, pageNumber, splitSide]);

  const handleNextPage = useCallback(() => {
    if (viewMode === 'scroll') {
      if (numPages) {
        const target = Math.min(pageNumber + 1, numPages);
        setPageNumber(target);
        scrollToPage(target);
      }
    } else if (viewMode === 'split') {
      if (splitSide === 'left') {
        setSplitSide('right');
      } else {
        if (numPages && pageNumber < numPages) {
          setPageNumber((prev) => prev + 1);
          setSplitSide('left');
        }
      }
    } else {
      if (numPages) {
        setPageNumber((prev) => Math.min(prev + 1, numPages));
      }
    }
  }, [viewMode, pageNumber, splitSide, numPages]);

  const handlePageVisible = useCallback((pageNum: number, isVisible: boolean) => {
    if (isVisible) {
      visiblePagesRef.current.add(pageNum);
    } else {
      visiblePagesRef.current.delete(pageNum);
    }

    if (visiblePagesRef.current.size > 0) {
      const minPage = Math.min(...Array.from(visiblePagesRef.current));
      setPageNumber(minPage);
    }
  }, []);

  const performZoom = useCallback((newZoom: number, focusYViewport?: number) => {
    const container = scrollContainerRef.current;
    if (!container) {
      setZoom(newZoom);
      return;
    }

    const oldZoom = zoom;
    const oldScrollTop = container.scrollTop;
    const containerRect = container.getBoundingClientRect();
    const yFocus = focusYViewport !== undefined ? focusYViewport : containerRect.height / 2;
    
    setZoom(newZoom);
    
    if (viewMode === 'scroll') {
      const ratio = newZoom / oldZoom;
      const targetScrollTop = oldScrollTop * ratio + yFocus * (ratio - 1);
      setTimeout(() => {
        container.scrollTop = targetScrollTop;
      }, 50);
    }
  }, [zoom, viewMode]);

  const handleZoomIn = () => {
    performZoom(Math.min(zoom + 0.2, 3.0));
  };

  const handleZoomOut = () => {
    performZoom(Math.max(zoom - 0.2, 0.5));
  };

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }
      if (e.key === 'ArrowLeft') {
        handlePrevPage();
      } else if (e.key === 'ArrowRight') {
        handleNextPage();
      } else if (e.key === '=' || e.key === '+') {
        performZoom(Math.min(zoom + 0.2, 3.0));
      } else if (e.key === '-') {
        performZoom(Math.max(zoom - 0.2, 0.5));
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handlePrevPage, handleNextPage, zoom, performZoom]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!readerRef.current) return;
    if (!document.fullscreenElement) {
      readerRef.current.requestFullscreen().catch((err) => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };



  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      // Clear single finger flags to prevent page flip or double-tap on release
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoom;
      
      const container = scrollContainerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        touchStartMidYViewportRef.current = (t1.clientY + t2.clientY) / 2 - containerRect.top;
      }
      
      const targetEl = zoomTargetRef.current;
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
        targetEl.style.transformOrigin = `${midX}px ${midY}px`;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      if (e.cancelable) e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const factor = dist / touchStartDistRef.current;
      
      const targetZoom = Math.min(Math.max(touchStartZoomRef.current * factor, 0.5), 3.0);
      
      const targetEl = zoomTargetRef.current;
      if (targetEl) {
        targetEl.style.transform = `scale(${factor})`;
      }
      gestureZoomRef.current = targetZoom;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const targetEl = zoomTargetRef.current;
    if (targetEl) {
      targetEl.style.transform = '';
      targetEl.style.transformOrigin = '';
    }

    if (gestureZoomRef.current !== null) {
      performZoom(gestureZoomRef.current, touchStartMidYViewportRef.current);
      gestureZoomRef.current = null;
      touchStartDistRef.current = null;
      return;
    }

    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    const moveDist = Math.hypot(deltaX, deltaY);

    if (moveDist < 8) {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        const container = scrollContainerRef.current;
        let yFocus: number | undefined;
        if (container && touchStartYRef.current !== null) {
          const containerRect = container.getBoundingClientRect();
          yFocus = touchStartYRef.current - containerRect.top;
        }
        
        performZoom(zoom === 1.0 ? 2.0 : 1.0, yFocus);
        lastTapTimeRef.current = 0; 
      } else {
        lastTapTimeRef.current = now;
      }
    } else {
      if (zoom === 1.0) {
        if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
          if (deltaX < 0) {
            handleNextPage();
          } else {
            handlePrevPage();
          }
        }
      }
    }
    
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  const handlePageSubmit = () => {
    const pageInt = parseInt(inputPageVal, 10);
    if (!isNaN(pageInt) && numPages && pageInt >= 1 && pageInt <= numPages) {
      setPageNumber(pageInt);
      if (viewMode === 'scroll') {
        scrollToPage(pageInt);
      }
    }
    setIsEditingPage(false);
  };

  const handleViewModeChange = (mode: 'single' | 'split' | 'scroll') => {
    setViewMode(mode);
    setSplitSide('left');
    if (mode === 'scroll') {
      setTimeout(() => {
        scrollToPage(pageNumber);
      }, 50);
    }
  };

  if (!book) {
    return null;
  }

  return (
    <div
      ref={readerRef}
      style={{
        background: '#191919',
        height: isFullscreen ? '100vh' : 'calc(100vh - 52px)',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Offline Warning Banner */}
      {mounted && !isOnline && (
        <div style={{
          background: 'rgba(217, 119, 6, 0.15)',
          borderBottom: '1px solid rgba(217, 119, 6, 0.3)',
          padding: '10px 16px',
          color: '#fbbf24',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 99,
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            Currently you&apos;re offline. Sync only happens when you get back online while you&apos;re in the app.
          </span>
        </div>
      )}

      {/* Reconnect Toast */}
      {mounted && wasOffline && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)',
          borderBottom: '1px solid rgba(16, 185, 129, 0.3)',
          padding: '10px 16px',
          color: '#34d399',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 99,
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Back online! Syncing reading progress and bookmarks...
          </span>
        </div>
      )}

      <button
        onClick={toggleFullscreen}
        style={{
          position: 'fixed',
          right: bookmarksPanelOpen ? (isMobile ? '24px' : '344px') : '24px',
          top: isFullscreen ? '24px' : '76px',
          background: '#202020',
          border: '1px solid #ffffff15',
          borderRadius: '4px',
          color: '#ffffff',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: '13px',
          zIndex: 1000,
          display: isMobile && bookmarksPanelOpen ? 'none' : 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'right 0.15s ease, top 0.15s ease, background 0.15s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#2f2f2f'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#202020'}
      >
        <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
        <span style={{ fontSize: '14px' }}>⛶</span>
      </button>

      <div
        ref={scrollContainerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          width: '100%',
          paddingBottom: isMobile ? '120px' : '80px',
          display: 'flex',
          flexDirection: 'column',
          touchAction: isMobile ? 'pan-x pan-y' : 'auto',
        }}
      >
        {loading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#888',
            fontSize: '14px',
          }}>
            {loadingMsg}
          </div>
        ) : viewMode === 'scroll' ? (
          <div
            ref={zoomTargetRef}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '24px auto 0 auto' }}
          >
            {Array.from({ length: numPages || 0 }, (_, i) => i + 1).map((pageNum) => (
              <div id={`scroll-page-${pageNum}`} key={pageNum} style={{ width: '100%' }}>
                <ScrollModePage
                  pageNumber={pageNum}
                  pdfDoc={pdfDoc!}
                  zoom={zoom}
                  pageAspectRatio={pageAspectRatio}
                  onVisible={handlePageVisible}
                  windowWidth={windowWidth}
                  isBookmarked={bookmarks.some((b) => b.pageNumber === pageNum)}
                  onToggleBookmark={() => {
                    setBookmarkNote(bookmarks.find((b) => b.pageNumber === pageNum)?.note || '');
                    setShowBookmarkPopup(pageNum);
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            width: '100%',
            maxWidth: `${Math.min(windowWidth - 32, 800) * zoom}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
            margin: '24px auto 0 auto',
          }}>
            {renderingPage && (
              <div style={{
                position: 'absolute',
                top: '20px',
                color: '#888',
                fontSize: '12px',
                background: 'rgba(25, 25, 25, 0.8)',
                padding: '4px 8px',
                borderRadius: '4px',
                zIndex: 5,
              }}>
                Loading page...
              </div>
            )}

            <div
              ref={zoomTargetRef}
              style={{
                width: '100%',
                overflow: 'hidden',
                position: 'relative',
                display: 'block',
              }}
            >
              {bookmarks.some((b) => b.pageNumber === pageNumber) && (
                <div
                  title="Bookmarked Page"
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: '16px',
                    width: '24px',
                    height: '36px',
                    background: '#fbbf24',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    zIndex: 8,
                    clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 50% 80%, 0% 100%)',
                    cursor: 'pointer',
                  }}
                  onClick={handleToggleBookmarkClick}
                />
              )}
              <canvas
                ref={canvasRef}
                style={{
                  width: viewMode === 'split' ? '200%' : '100%',
                  maxWidth: 'none',
                  height: 'auto',
                  background: '#191919',
                  transform: viewMode === 'split' && splitSide === 'right' ? 'translateX(-50%)' : 'translateX(0)',
                  transformOrigin: 'left top',
                  transition: 'transform 0.2s ease-in-out',
                  display: 'block',
                }}
              />
              <div
                ref={textLayerRef}
                className="textLayer"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: viewMode === 'split' && splitSide === 'right' ? 'translateX(-50%)' : 'translateX(0)',
                  transformOrigin: 'left top',
                  transition: 'transform 0.2s ease-in-out',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100vw',
        height: isMobile ? '96px' : '56px',
        background: '#202020',
        borderTop: '1px solid #2f2f2f',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: isMobile ? '8px 16px' : '0 24px',
        zIndex: 100,
        boxSizing: 'border-box',
        gap: isMobile ? '4px' : '0',
      }}>
        {isMobile ? (
          <>
            {}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              height: '40px',
              borderBottom: '1px solid #ffffff05',
              paddingBottom: '4px',
            }}>
              <a
                href="/"
                style={{
                  color: '#ffffff',
                  fontSize: '13px',
                  textDecoration: 'none',
                }}
              >
                ← Back
              </a>

              <div style={{ color: '#ffffff', fontSize: '13px', display: 'flex', alignItems: 'center' }}>
                {isEditingPage ? (
                  <input
                    type="text"
                    value={inputPageVal}
                    onChange={(e) => setInputPageVal(e.target.value)}
                    onBlur={handlePageSubmit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handlePageSubmit();
                      if (e.key === 'Escape') setIsEditingPage(false);
                    }}
                    autoFocus
                    style={{
                      background: '#191919',
                      border: '1px solid #2f2f2f',
                      color: '#ffffff',
                      width: '40px',
                      textAlign: 'center',
                      padding: '2px',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <span
                    onClick={() => {
                      setInputPageVal(String(pageNumber));
                      setIsEditingPage(true);
                    }}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    {pageNumber}
                    {viewMode === 'split' && (splitSide === 'left' ? ' (L)' : ' (R)')}
                  </span>
                )}
                <span style={{ color: '#888', margin: '0 4px' }}>/</span>
                <span style={{ color: '#888' }}>{numPages || book.totalPages || '…'}</span>
              </div>

              {}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.5}
                  style={{
                    background: 'none',
                    border: '1px solid #2f2f2f',
                    color: zoom <= 0.5 ? '#555' : '#ffffff',
                    cursor: zoom <= 0.5 ? 'default' : 'pointer',
                    fontSize: '13px',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                  }}
                >
                  -
                </button>
                <span style={{ fontSize: '12px', minWidth: '36px', textAlign: 'center', userSelect: 'none' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= 3.0}
                  style={{
                    background: 'none',
                    border: '1px solid #2f2f2f',
                    color: zoom >= 3.0 ? '#555' : '#ffffff',
                    cursor: zoom >= 3.0 ? 'default' : 'pointer',
                    fontSize: '13px',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              height: '40px',
              paddingTop: '4px',
            }}>
              {}
              <div style={{
                display: 'flex',
                background: '#151515',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid #ffffff10',
              }}>
                {(['single', 'split', 'scroll'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleViewModeChange(mode)}
                    style={{
                      background: viewMode === mode ? '#333333' : 'transparent',
                      border: 'none',
                      color: viewMode === mode ? '#ffffff' : '#888888',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: viewMode === mode ? '600' : 'normal',
                      transition: 'all 0.15s ease',
                      outline: 'none',
                    }}
                  >
                    {mode === 'single' ? 'Page' : mode === 'split' ? 'Split' : 'Scroll'}
                  </button>
                ))}
              </div>

              {/* Bookmarks Actions (Mobile) */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <button
                  onClick={handleToggleBookmarkClick}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: bookmarks.some((b) => b.pageNumber === pageNumber) ? '#fbbf24' : '#888888',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Bookmark current page"
                >
                  {bookmarks.some((b) => b.pageNumber === pageNumber) ? '★' : '☆'}
                </button>

                <button
                  onClick={() => setBookmarksPanelOpen(!bookmarksPanelOpen)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: bookmarksPanelOpen ? '#ffffff' : '#888888',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="View Bookmarks"
                >
                  📑
                </button>
              </div>

              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <button
                  onClick={handlePrevPage}
                  disabled={pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: (pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')) ? '#555' : '#ffffff',
                    cursor: (pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')) ? 'default' : 'pointer',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  ‹ Prev
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={!!(numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right'))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: (numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right')) ? '#555' : '#ffffff',
                    cursor: (numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right')) ? 'default' : 'pointer',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  Next ›
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <a
              href="/"
              style={{
                color: '#ffffff',
                fontSize: '13px',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
            >
              ← Back
            </a>

            <div style={{ color: '#ffffff', fontSize: '13px', display: 'flex', alignItems: 'center' }}>
              {isEditingPage ? (
                <input
                  type="text"
                  value={inputPageVal}
                  onChange={(e) => setInputPageVal(e.target.value)}
                  onBlur={handlePageSubmit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePageSubmit();
                    if (e.key === 'Escape') setIsEditingPage(false);
                  }}
                  autoFocus
                  style={{
                    background: '#191919',
                    border: '1px solid #2f2f2f',
                    color: '#ffffff',
                    width: '40px',
                    textAlign: 'center',
                    padding: '2px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              ) : (
                <span
                  onClick={() => {
                    setInputPageVal(String(pageNumber));
                    setIsEditingPage(true);
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  {pageNumber}
                  {viewMode === 'split' && (splitSide === 'left' ? ' (L)' : ' (R)')}
                </span>
              )}
              <span style={{ color: '#888', margin: '0 4px' }}>/</span>
              <span style={{ color: '#888' }}>{numPages || book.totalPages || '…'}</span>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              {}
              <div style={{
                display: 'flex',
                background: '#151515',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid #ffffff10',
              }}>
                {(['single', 'split', 'scroll'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleViewModeChange(mode)}
                    style={{
                      background: viewMode === mode ? '#333333' : 'transparent',
                      border: 'none',
                      color: viewMode === mode ? '#ffffff' : '#888888',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontWeight: viewMode === mode ? '600' : 'normal',
                      transition: 'all 0.15s ease',
                      outline: 'none',
                    }}
                  >
                    {mode === 'single' ? 'Page' : mode === 'split' ? 'Split' : 'Scroll'}
                  </button>
                ))}
              </div>

              {}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.5}
                  style={{
                    background: 'none',
                    border: '1px solid #2f2f2f',
                    color: zoom <= 0.5 ? '#555' : '#ffffff',
                    cursor: zoom <= 0.5 ? 'default' : 'pointer',
                    fontSize: '13px',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                  }}
                >
                  -
                </button>
                <span style={{ fontSize: '12px', minWidth: '40px', textAlign: 'center', userSelect: 'none' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= 3.0}
                  style={{
                    background: 'none',
                    border: '1px solid #2f2f2f',
                    color: zoom >= 3.0 ? '#555' : '#ffffff',
                    cursor: zoom >= 3.0 ? 'default' : 'pointer',
                    fontSize: '13px',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                  }}
                >
                  +
                </button>
              </div>

              {/* Bookmarks Actions */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginRight: '8px', borderRight: '1px solid #ffffff10', paddingRight: '16px' }}>
                <button
                  onClick={handleToggleBookmarkClick}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: bookmarks.some((b) => b.pageNumber === pageNumber) ? '#fbbf24' : '#888888',
                    cursor: 'pointer',
                    fontSize: '20px',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => { if (!bookmarks.some((b) => b.pageNumber === pageNumber)) e.currentTarget.style.color = '#ffffff'; }}
                  onMouseLeave={(e) => { if (!bookmarks.some((b) => b.pageNumber === pageNumber)) e.currentTarget.style.color = '#888888'; }}
                  title="Bookmark current page"
                >
                  {bookmarks.some((b) => b.pageNumber === pageNumber) ? '★' : '☆'}
                </button>

                <button
                  onClick={() => setBookmarksPanelOpen(!bookmarksPanelOpen)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: bookmarksPanelOpen ? '#ffffff' : '#888888',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => { if (!bookmarksPanelOpen) e.currentTarget.style.color = '#ffffff'; }}
                  onMouseLeave={(e) => { if (!bookmarksPanelOpen) e.currentTarget.style.color = '#888888'; }}
                  title="View Bookmarks"
                >
                  📑
                </button>
              </div>

              <button
                onClick={handlePrevPage}
                disabled={pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: (pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')) ? '#555' : '#ffffff',
                  cursor: (pageNumber <= 1 && (viewMode !== 'split' || splitSide === 'left')) ? 'default' : 'pointer',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                ‹ Prev
              </button>
              <button
                onClick={handleNextPage}
                disabled={!!(numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right'))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: (numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right')) ? '#555' : '#ffffff',
                  cursor: (numPages && pageNumber >= numPages && (viewMode !== 'split' || splitSide === 'right')) ? 'default' : 'pointer',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                Next ›
              </button>
            </div>
          </>
        )}
      </div>

      {/* Bookmarks Slide-Out Panel */}
      {bookmarksPanelOpen && (
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: isMobile ? '100%' : '320px',
          height: '100%',
          background: '#202020',
          borderLeft: '1px solid #2f2f2f',
          boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 500,
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #2f2f2f',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ color: '#ffffff', fontSize: '16px', fontWeight: 500 }}>Bookmarks</span>
            <button
              onClick={() => setBookmarksPanelOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888888',
                fontSize: '18px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          {/* List */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {bookmarks.length === 0 ? (
              <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', marginTop: '24px' }}>
                No bookmarks yet. Click the star icon on any page to add one.
              </div>
            ) : (
              bookmarks.map((b) => (
                <div
                  key={b.pageNumber}
                  style={{
                    background: '#191919',
                    border: '1px solid #2f2f2f',
                    borderRadius: '6px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      onClick={() => {
                        setPageNumber(b.pageNumber);
                        if (viewMode === 'scroll') {
                          scrollToPage(b.pageNumber);
                        }
                        if (isMobile) {
                          setBookmarksPanelOpen(false);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#fbbf24',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        padding: 0,
                        textAlign: 'left',
                      }}
                    >
                      Page {b.pageNumber}
                    </button>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => {
                          setBookmarkNote(b.note || '');
                          setShowBookmarkPopup(b.pageNumber);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#888',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                        title="Edit Note"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteBookmark(b.pageNumber)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ff5555',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {b.note ? (
                    <div style={{
                      color: '#bbb',
                      fontSize: '12px',
                      lineHeight: '1.4',
                      background: '#151515',
                      padding: '8px',
                      borderRadius: '4px',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {b.note}
                    </div>
                  ) : (
                    <div style={{ color: '#555', fontSize: '11px', fontStyle: 'italic' }}>
                      No note added
                    </div>
                  )}

                  {b.pendingSync && (
                    <div style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '8px',
                      fontSize: '9px',
                      color: b.pendingSync === 'add' ? '#fbbf24' : '#ff5555',
                    }}>
                      {b.pendingSync === 'add' ? 'Pending offline add' : 'Pending offline delete'}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Bookmark Add/Edit Dialog Modal */}
      {showBookmarkPopup !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#202020',
            border: '1px solid #2f2f2f',
            borderRadius: '8px',
            padding: '24px',
            width: '360px',
            maxWidth: '90vw',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#ffffff', fontSize: '15px', fontWeight: 500 }}>
                {bookmarks.some((b) => b.pageNumber === showBookmarkPopup) ? 'Edit Bookmark Note' : 'Add Bookmark'}
              </span>
              <span style={{ color: '#888888', fontSize: '13px' }}>Page {showBookmarkPopup}</span>
            </div>

            <textarea
              placeholder="Add a custom note (optional)..."
              value={bookmarkNote}
              onChange={(e) => setBookmarkNote(e.target.value)}
              rows={4}
              style={{
                background: '#151515',
                border: '1px solid #2f2f2f',
                borderRadius: '6px',
                color: '#ffffff',
                padding: '10px',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'none',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
              {bookmarks.some((b) => b.pageNumber === showBookmarkPopup) ? (
                <button
                  onClick={() => handleDeleteBookmark(showBookmarkPopup)}
                  style={{
                    background: 'none',
                    border: '1px solid #ff555540',
                    borderRadius: '4px',
                    color: '#ff5555',
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setShowBookmarkPopup(null)}
                  style={{
                    background: 'none',
                    border: '1px solid #2f2f2f',
                    borderRadius: '4px',
                    color: '#888',
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBookmark}
                  style={{
                    background: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#000000',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {customAlert && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{
            background: '#202020',
            border: '1px solid #2f2f2f',
            borderRadius: '8px',
            padding: '24px',
            width: '320px',
            maxWidth: '90vw',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          }}>
            <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: 500 }}>
              {customAlert.title || 'Notification'}
            </div>
            <div style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.5' }}>
              {customAlert.message}
            </div>
            <button
              onClick={() => setCustomAlert(null)}
              style={{
                marginTop: '8px',
                background: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                color: '#000000',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ScrollModePageProps {
  pageNumber: number;
  pdfDoc: PDFDocumentProxy;
  zoom: number;
  pageAspectRatio: number;
  onVisible: (pageNumber: number, isVisible: boolean) => void;
  windowWidth: number;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}

function ScrollModePage({
  pageNumber,
  pdfDoc,
  zoom,
  pageAspectRatio,
  onVisible,
  windowWidth,
  isBookmarked,
  onToggleBookmark,
}: ScrollModePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<PDFRenderTask | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        rootMargin: '600px 0px 600px 0px',
      }
    );

    const viewportObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          onVisible(pageNumber, entry.isIntersecting);
        });
      },
      {
        rootMargin: '0px 0px 0px 0px',
      }
    );

    const currentRef = containerRef.current;
    if (currentRef) {
      preloadObserver.observe(currentRef);
      viewportObserver.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        preloadObserver.unobserve(currentRef);
        viewportObserver.unobserve(currentRef);
      }
      preloadObserver.disconnect();
      viewportObserver.disconnect();
    };
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!isVisible) {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      setIsRendered(false);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
      }
      return;
    }

    let active = true;

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');

        if (canvas && context) {
          const desiredWidth = Math.min(windowWidth - 32, 800) * zoom;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const outputScale = Math.min(
            Math.max((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2.0),
            3.0
          );
          const scale = (desiredWidth / unscaledViewport.width) * outputScale;
          const viewport = page.getViewport({ scale });

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);

          const renderContext = {
            canvasContext: context,
            viewport,
          };

          if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
          }

          const renderTask = page.render(renderContext);
          renderTaskRef.current = renderTask;
          await renderTask.promise;
          if (active) {
            setIsRendered(true);

            // Render text selection layer
            if (textLayerRef.current) {
              const pdfjs = (window as unknown as { pdfjsLib?: { renderTextLayer: (params: unknown) => { promise: Promise<void> } } }).pdfjsLib;
              if (pdfjs?.renderTextLayer) {
                const textLayerDiv = textLayerRef.current;
                textLayerDiv.innerHTML = '';
                textLayerDiv.style.width = `${desiredWidth}px`;
                textLayerDiv.style.height = `${desiredWidth * (viewport.height / viewport.width)}px`;
                const cssViewport = page.getViewport({ scale: desiredWidth / unscaledViewport.width });
                const textContent = await page.getTextContent();
                pdfjs.renderTextLayer({
                  textContentSource: textContent,
                  container: textLayerDiv,
                  viewport: cssViewport,
                });
              }
            }
          }
        }
      } catch (err) {
        const errorName = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
        if (errorName !== 'RenderingCancelledException') {
          console.error(`Page ${pageNumber} rendering error:`, err);
        }
      }
    }

    renderPage();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [isVisible, pdfDoc, pageNumber, zoom, windowWidth]);

  const desiredWidth = Math.min(windowWidth - 32, 800) * zoom;
  const height = desiredWidth * pageAspectRatio;

  return (
    <div
      ref={containerRef}
      style={{
        width: `${desiredWidth}px`,
        height: `${height}px`,
        margin: '16px auto',
        background: '#151515',
        position: 'relative',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isBookmarked && (
        <div
          title="Bookmarked Page"
          style={{
            position: 'absolute',
            top: 0,
            right: '16px',
            width: '20px',
            height: '30px',
            background: '#fbbf24',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            zIndex: 8,
            clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 50% 80%, 0% 100%)',
            cursor: 'pointer',
          }}
          onClick={onToggleBookmark}
        />
      )}
      {!isRendered && (
        <div style={{ color: '#555', fontSize: '13px', position: 'absolute' }}>
          Loading page {pageNumber}...
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '4px',
          display: isRendered ? 'block' : 'none',
        }}
      />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}
