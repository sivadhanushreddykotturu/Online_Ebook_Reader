'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCachedPdf, cachePdf } from '@/lib/pdfCache';

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
}

interface PDFRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export default function ReaderComponent({ initialBook }: { initialBook: Book }) {
  const router = useRouter();
  const [book] = useState<Book>(initialBook);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(() => {
    if (typeof window !== 'undefined') {
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<PDFRenderTask | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
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
          };
        }).pdfjsLib;
        if (!pdfjs) {
          throw new Error('PDF.js not loaded. Check script injection.');
        }
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch(`/api/books/${book._id}`);
          if (res.ok) {
            const latestBook = await res.json();
            if (latestBook && typeof latestBook.currentPage === 'number') {
              setPageNumber((current) => {
                if (current !== latestBook.currentPage) {
                  localStorage.setItem(`book-progress-${book._id}`, latestBook.currentPage.toString());
                  return latestBook.currentPage;
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
  }, [book]);

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
        setZoom((prev) => Math.min(prev + 0.2, 3.0));
      } else if (e.key === '-') {
        setZoom((prev) => Math.max(prev - 0.2, 0.5));
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handlePrevPage, handleNextPage]);

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

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.2, 3.0));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.2, 0.5));
  };

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoom;
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
        targetEl.style.transformOrigin = 'center center';
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
      setZoom(gestureZoomRef.current);
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
        setZoom((prev) => (prev === 1.0 ? 2.0 : 1.0));
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
      <button
        onClick={toggleFullscreen}
        style={{
          position: 'fixed',
          right: '24px',
          top: isFullscreen ? '24px' : '76px',
          background: '#202020',
          border: '1px solid #ffffff15',
          borderRadius: '4px',
          color: '#ffffff',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: '13px',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'top 0.15s ease, background 0.15s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#2f2f2f'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#202020'}
      >
        <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
        <span style={{ fontSize: '14px' }}>⛶</span>
      </button>

      <div
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
}

function ScrollModePage({ pageNumber, pdfDoc, zoom, pageAspectRatio, onVisible, windowWidth }: ScrollModePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    </div>
  );
}
