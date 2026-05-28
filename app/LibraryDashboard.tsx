'use client';

import { useState, useEffect, useRef } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { uploadBook } from '@/lib/uploadBook';

interface Book {
  _id: string;
  r2Key: string;
  title: string;
  currentPage: number;
  totalPages: number;
  updatedAt: string;
  coverKey?: string;
  customCoverStyle?: string;
}

interface MiniPDFPage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
}

interface MiniPDFDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<MiniPDFPage>;
}

const COVER_PRESETS = [
  { id: 'gradient-sunset', name: 'Deep Sunset', style: 'linear-gradient(135deg, #ff5e62, #ff9966)' },
  { id: 'gradient-ocean', name: 'Ocean Breeze', style: 'linear-gradient(135deg, #2b5876, #4e4376)' },
  { id: 'gradient-forest', name: 'Midnight Forest', style: 'linear-gradient(135deg, #11998e, #38ef7d)' },
  { id: 'gradient-twilight', name: 'Purple Twilight', style: 'linear-gradient(135deg, #0f2027, #2c5364)' },
  { id: 'gradient-berry', name: 'Wild Berry', style: 'linear-gradient(135deg, #834d9b, #d04ed6)' },
  { id: 'gradient-nebula', name: 'Cosmic Nebula', style: 'linear-gradient(135deg, #f857a6, #ff5858)' },
];

async function extractCoverBlob(pdf: MiniPDFDocument): Promise<Blob> {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  const targetWidth = 200;
  const scale = targetWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(scaledViewport.width);
  canvas.height = Math.floor(scaledViewport.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to get 2D context');
  }

  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert canvas to blob'));
    }, 'image/jpeg', 0.85);
  });
}

function BookCoverDisplay({ book }: { book: Book }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [book.coverKey, book.customCoverStyle]);

  const preset = COVER_PRESETS.find((p) => p.id === book.customCoverStyle);
  const backgroundStyle = preset ? preset.style : 'linear-gradient(135deg, #252525, #191919)';
  const showFallback = !book.coverKey || imgError;

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '2/3',
        borderRadius: '4px',
        overflow: 'hidden',
        position: 'relative',
        background: '#151515',
        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
        border: '1px solid #ffffff08',
        marginBottom: '4px',
      }}
    >
      {showFallback ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: backgroundStyle,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            textAlign: 'center',
            color: '#ffffff',
            userSelect: 'none',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.7 }}>📖</div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 500,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '1.4',
              opacity: 0.9,
            }}
          >
            {book.title}
          </div>
        </div>
      ) : (
        <img
          src={`/api/books/${book._id}/cover`}
          alt={book.title}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
    </div>
  );
}


export default function LibraryDashboard() {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Upload States
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detectedPages, setDetectedPages] = useState<number | null>(null);
  const [isDetectingPages, setIsDetectingPages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [selectedCoverBlob, setSelectedCoverBlob] = useState<Blob | null>(null);

  // Custom cover states
  const [customizingBook, setCustomizingBook] = useState<Book | null>(null);
  const [customCoverFile, setCustomCoverFile] = useState<File | null>(null);
  const [extractPageNum, setExtractPageNum] = useState<number>(1);
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);
  const [coverStatus, setCoverStatus] = useState('');

  // Dropdown & Rename States
  const [activeDropdownBookId, setActiveDropdownBookId] = useState<string | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editTitleVal, setEditTitleVal] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cached = localStorage.getItem('library-books-cache');
    if (cached) {
      try {
        setBooks(JSON.parse(cached));
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to parse cached library:', err);
      }
    }
    fetchBooks();
  }, []);

  // Click outside to close dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.book-menu-trigger') || target.closest('.book-menu-dropdown')) {
        return;
      }
      setActiveDropdownBookId(null);
    }
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  async function fetchBooks() {
    const cached = localStorage.getItem('library-books-cache');
    if (!cached) {
      setIsLoading(true);
    }
    try {
      const res = await fetch('/api/books');
      if (res.ok) {
        const data = await res.json();
        setBooks(data);
        localStorage.setItem('library-books-cache', JSON.stringify(data));
      }
    } catch (err) {
      console.error('Failed to fetch books:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // Handle PDF parsing when file is selected
  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are allowed');
      return;
    }
    setSelectedFile(file);
    setDetectedPages(null);
    setIsDetectingPages(true);
    setUploadStatus('');
    setUploadProgress(null);
    setSelectedCoverBlob(null);

    try {
      const pdfjs = (window as unknown as {
        pdfjsLib?: {
          GlobalWorkerOptions: { workerSrc: string };
          getDocument: (url: string) => { promise: Promise<MiniPDFDocument> };
        };
      }).pdfjsLib;
      if (!pdfjs) {
        throw new Error('PDF.js library not loaded yet.');
      }
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      
      const fileURL = URL.createObjectURL(file);
      const loadingTask = pdfjs.getDocument(fileURL);
      const pdf = await loadingTask.promise;
      setDetectedPages(pdf.numPages);

      // Auto-extract cover blob
      try {
        const cover = await extractCoverBlob(pdf);
        setSelectedCoverBlob(cover);
      } catch (coverErr) {
        console.error('Error generating PDF cover preview:', coverErr);
      }

      URL.revokeObjectURL(fileURL);
    } catch (err) {
      console.error('Error parsing PDF:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      alert(`Error detecting pages: ${errMsg}`);
    } finally {
      setIsDetectingPages(false);
    }
  };

  // Drag and Drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Perform upload flow
  const handleUpload = async () => {
    if (!selectedFile || detectedPages === null) return;

    setUploadProgress(0);
    setUploadStatus('');

    try {
      await uploadBook(selectedFile, detectedPages, selectedCoverBlob, {
        onStatus: (status) => setUploadStatus(status),
        onProgress: (percent) => setUploadProgress(percent),
      });

      // Reload library list
      fetchBooks();

      // Auto close modal after 1.5 seconds
      setTimeout(() => {
        setIsModalOpen(false);
        setSelectedFile(null);
        setDetectedPages(null);
        setSelectedCoverBlob(null);
        setUploadProgress(null);
        setUploadStatus('');
      }, 1500);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setUploadStatus(`Error: ${errMsg}`);
    }
  };

  const handleRenameSubmit = async (bookId: string, originalTitle: string) => {
    const newTitle = editTitleVal.trim();
    setEditingBookId(null);
    if (!newTitle || newTitle === originalTitle) {
      return;
    }

    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        const updated = await res.json();
        const updatedBooks = books.map(b => b._id === bookId ? { ...b, title: updated.title } : b);
        setBooks(updatedBooks);
        localStorage.setItem('library-books-cache', JSON.stringify(updatedBooks));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmDelete = async (bookId: string, title: string) => {
    const confirmed = confirm(`Are you sure you want to delete "${title}"? This will permanently delete the file from both storage and library database.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const updatedBooks = books.filter(b => b._id !== bookId);
        setBooks(updatedBooks);
        localStorage.setItem('library-books-cache', JSON.stringify(updatedBooks));
      } else {
        const errData = await res.json();
        alert(`Failed to delete book: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('An error occurred while deleting the book.');
    }
  };

  // Preset Selection Cover update
  const handleSelectPreset = async (bookId: string, presetId: string) => {
    setIsUpdatingCover(true);
    setCoverStatus('Saving preset...');
    try {
      const res = await fetch(`/api/books/${bookId}/cover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
      if (res.ok) {
        const updatedBooks = books.map(b => b._id === bookId ? { ...b, coverKey: undefined, customCoverStyle: presetId } : b);
        setBooks(updatedBooks);
        localStorage.setItem('library-books-cache', JSON.stringify(updatedBooks));
        setCustomizingBook(null);
      } else {
        alert('Failed to update preset');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred');
    } finally {
      setIsUpdatingCover(false);
    }
  };

  // Upload Custom Cover
  const handleUploadCustomCover = async (bookId: string) => {
    if (!customCoverFile) return;
    setIsUpdatingCover(true);
    setCoverStatus('Uploading cover image...');
    
    const formData = new FormData();
    formData.append('cover', customCoverFile);

    try {
      const res = await fetch(`/api/books/${bookId}/cover`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        const updatedBooks = books.map(b => b._id === bookId ? { ...b, coverKey: data.coverKey, customCoverStyle: undefined } : b);
        setBooks(updatedBooks);
        localStorage.setItem('library-books-cache', JSON.stringify(updatedBooks));
        setCustomizingBook(null);
      } else {
        alert('Failed to upload custom cover');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred during upload');
    } finally {
      setIsUpdatingCover(false);
    }
  };

  // Generate cover from specific PDF page
  const handleExtractFromPage = async (bookId: string, pageNum: number) => {
    setIsUpdatingCover(true);
    setCoverStatus(`Downloading PDF and rendering page ${pageNum}...`);
    
    try {
      // 1. Fetch PDF buffer
      const pdfRes = await fetch(`/api/pdf/${bookId}`);
      if (!pdfRes.ok) throw new Error('Failed to fetch PDF file');
      const arrayBuffer = await pdfRes.arrayBuffer();

      // 2. Load using PDF.js
      const pdfjs = (window as unknown as {
        pdfjsLib?: {
          getDocument: (options: { data: Uint8Array }) => { promise: Promise<MiniPDFDocument> };
        };
      }).pdfjsLib;
      if (!pdfjs) throw new Error('PDF.js library not loaded yet');
      
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;
      
      if (pageNum < 1 || pageNum > pdf.numPages) {
        throw new Error(`Invalid page number. Page must be between 1 and ${pdf.numPages}.`);
      }

      setCoverStatus(`Extracting page ${pageNum}...`);
      
      // 3. Extract cover blob from page
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const targetWidth = 200;
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(scaledViewport.width);
      canvas.height = Math.floor(scaledViewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Failed to get canvas 2D context');

      await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

      const coverBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob from canvas'));
        }, 'image/jpeg', 0.85);
      });

      setCoverStatus('Uploading cover to server...');

      // 4. Send cover to POST endpoint
      const formData = new FormData();
      formData.append('cover', coverBlob, `page-${pageNum}.jpg`);

      const uploadRes = await fetch(`/api/books/${bookId}/cover`, {
        method: 'POST',
        body: formData,
      });

      if (uploadRes.ok) {
        const data = await uploadRes.json();
        const updatedBooks = books.map(b => b._id === bookId ? { ...b, coverKey: data.coverKey, customCoverStyle: undefined } : b);
        setBooks(updatedBooks);
        localStorage.setItem('library-books-cache', JSON.stringify(updatedBooks));
        setCustomizingBook(null);
      } else {
        alert('Failed to save extracted cover');
      }
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      alert(errMsg || 'An error occurred during extraction');
    } finally {
      setIsUpdatingCover(false);
    }
  };

  return (
    <>
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        strategy="afterInteractive"
      />

      <div style={{ padding: '40px 24px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 400, color: '#ffffff' }}>Library</h1>
          <button
            onClick={() => setIsModalOpen(true)}
            style={{
              border: '1px solid #2f2f2f',
              background: 'transparent',
              color: '#ffffff',
              padding: '8px 16px',
              fontSize: '14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#202020'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            + Add Book
          </button>
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div style={{ color: '#888', fontSize: '14px' }}>Loading your library…</div>
        ) : books.length === 0 ? (
          <div style={{ color: '#888', fontSize: '14px' }}>No books in your library. Click &quot;+ Add Book&quot; to upload your first PDF.</div>
        ) : (
          /* Cards Grid */
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '24px',
          }}>
            {books.map((book) => {
              const pct = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
              return (
                <div
                  key={book._id}
                  style={{
                    background: '#202020',
                    border: '1px solid #ffffff15',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'border-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#ffffff30'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = '#ffffff15'}
                >
                  {/* Book Cover Preview */}
                  <BookCoverDisplay book={book} />

                  {/* Title & Actions Dropdown */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                    {editingBookId === book._id ? (
                      <input
                        type="text"
                        value={editTitleVal}
                        onChange={(e) => setEditTitleVal(e.target.value)}
                        onBlur={() => handleRenameSubmit(book._id, book.title)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(book._id, book.title);
                          if (e.key === 'Escape') setEditingBookId(null);
                        }}
                        autoFocus
                        style={{
                          background: '#191919',
                          border: '1px solid #ffffff30',
                          borderRadius: '4px',
                          color: '#ffffff',
                          fontSize: '15px',
                          padding: '2px 6px',
                          width: '100%',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          color: '#ffffff',
                          fontSize: '15px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: 'block',
                          flexGrow: 1,
                          paddingRight: '24px',
                        }}
                        title={book.title}
                      >
                        {book.title}
                      </span>
                    )}

                    {editingBookId !== book._id && (
                      <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                        <button
                          className="book-menu-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdownBookId(activeDropdownBookId === book._id ? null : book._id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#888',
                            fontSize: '18px',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            lineHeight: '1',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
                        >
                          ⋮
                        </button>

                        {activeDropdownBookId === book._id && (
                          <div className="book-menu-dropdown" style={{
                            position: 'absolute',
                            right: 0,
                            top: '24px',
                            background: '#252525',
                            border: '1px solid #ffffff15',
                            borderRadius: '4px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            zIndex: 10,
                            minWidth: '100px',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '4px 0',
                          }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomizingBook(book);
                                setCustomCoverFile(null);
                                setExtractPageNum(1);
                                setCoverStatus('');
                                setActiveDropdownBookId(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ffffff',
                                fontSize: '13px',
                                padding: '8px 12px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                width: '100%',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#303030'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                            >
                              Change Cover
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingBookId(book._id);
                                setEditTitleVal(book.title);
                                setActiveDropdownBookId(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ffffff',
                                fontSize: '13px',
                                padding: '8px 12px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                width: '100%',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#303030'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                            >
                              Rename
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmDelete(book._id, book.title);
                                setActiveDropdownBookId(null);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ff5555',
                                fontSize: '13px',
                                padding: '8px 12px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                width: '100%',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#303030'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress String */}
                  <div style={{ fontSize: '12px', color: '#888' }}>
                    {book.currentPage} / {book.totalPages} pages
                  </div>

                  {/* Thin Progress Bar */}
                  <div style={{ width: '100%', height: '4px', background: '#ffffff20' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: '#ffffff',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>

                  {/* Resume Link */}
                  <div style={{ marginTop: '4px' }}>
                    <Link
                      href={`/reader/${book._id}`}
                      style={{
                        color: '#ffffff',
                        fontSize: '13px',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                      Resume
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            if (!uploadProgress) setIsModalOpen(false);
          }}
        >
          <div
            style={{
              background: '#202020',
              border: '1px solid #2f2f2f',
              padding: '24px',
              width: '400px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#ffffff', fontSize: '15px' }}>Upload PDF Book</span>
              {!uploadProgress && (
                <button
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Drag & Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '1px dashed #2f2f2f',
                padding: '32px',
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: '13px',
                color: '#888',
                background: dragActive ? '#282828' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleFileChange(e.target.files?.[0])}
              />
              {selectedFile ? (
                <div style={{ color: '#ffffff' }}>
                  <div style={{ wordBreak: 'break-all', marginBottom: '4px' }}>{selectedFile.name}</div>
                  <div style={{ color: '#888', fontSize: '12px' }}>
                    {isDetectingPages ? 'Detecting pages...' : detectedPages !== null ? `Pages detected: ${detectedPages}` : ''}
                  </div>
                </div>
              ) : (
                <div>Drag & drop your PDF here, or click to browse</div>
              )}
            </div>

            {/* Upload Button */}
            {selectedFile && detectedPages !== null && !uploadProgress && (
              <button
                onClick={handleUpload}
                style={{
                  border: '1px solid #2f2f2f',
                  background: 'transparent',
                  color: '#ffffff',
                  padding: '8px 16px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#282828'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Upload
              </button>
            )}

            {/* Progress indicators */}
            {uploadStatus && (
              <div style={{ marginTop: '8px' }}>
                <pre style={{
                  background: '#191919',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#888',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  border: '1px solid #2f2f2f',
                }}>
                  {uploadStatus}
                </pre>
                {uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100 && (
                  <div style={{ width: '100%', height: '2px', background: '#2f2f2f', marginTop: '8px' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#ffffff' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customize Cover Modal */}
      {customizingBook && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            if (!isUpdatingCover) setCustomizingBook(null);
          }}
        >
          <div
            style={{
              background: '#202020',
              border: '1px solid #2f2f2f',
              padding: '24px',
              width: '450px',
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#ffffff', fontSize: '15px', fontWeight: 500 }}>Customize Cover</span>
              {!isUpdatingCover && (
                <button
                  onClick={() => setCustomizingBook(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Preview and presets block */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              {/* Cover Preview */}
              <div style={{ width: '100px', flexShrink: 0 }}>
                <BookCoverDisplay book={customizingBook} />
              </div>
              <div style={{ flexGrow: 1 }}>
                <div style={{ color: '#ffffff', fontSize: '14px', marginBottom: '4px', fontWeight: 500 }}>
                  {customizingBook.title}
                </div>
                <div style={{ color: '#888', fontSize: '12px' }}>
                  Choose a preset gradient style, upload your own cover image, or render any page from this PDF.
                </div>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #2f2f2f', margin: 0 }} />

            {/* Presets Grid */}
            <div>
              <div style={{ color: '#ffffff', fontSize: '13px', marginBottom: '10px' }}>Select Preset Gradient</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {COVER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    disabled={isUpdatingCover}
                    onClick={() => handleSelectPreset(customizingBook._id, preset.id)}
                    style={{
                      background: preset.style,
                      border: customizingBook.customCoverStyle === preset.id ? '2px solid #ffffff' : '1px solid #ffffff15',
                      borderRadius: '4px',
                      color: '#ffffff',
                      padding: '8px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontWeight: 500,
                      textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      height: '40px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #2f2f2f', margin: 0 }} />

            {/* Custom Upload */}
            <div>
              <div style={{ color: '#ffffff', fontSize: '13px', marginBottom: '10px' }}>Upload Cover Image</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUpdatingCover}
                  onChange={(e) => setCustomCoverFile(e.target.files?.[0] || null)}
                  style={{
                    background: '#151515',
                    border: '1px solid #2f2f2f',
                    color: '#888',
                    padding: '6px',
                    fontSize: '12px',
                    flexGrow: 1,
                    outline: 'none',
                  }}
                />
                {customCoverFile && (
                  <button
                    disabled={isUpdatingCover}
                    onClick={() => handleUploadCustomCover(customizingBook._id)}
                    style={{
                      border: '1px solid #2f2f2f',
                      background: 'transparent',
                      color: '#ffffff',
                      padding: '6px 12px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Upload
                  </button>
                )}
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #2f2f2f', margin: 0 }} />

            {/* Dynamic Page Extraction */}
            <div>
              <div style={{ color: '#ffffff', fontSize: '13px', marginBottom: '4px' }}>Extract Page from PDF</div>
              <div style={{ color: '#888', fontSize: '11px', marginBottom: '10px' }}>
                Extract and render any page from this PDF to use as the cover.
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="number"
                  min="1"
                  max={customizingBook.totalPages || 9999}
                  value={extractPageNum}
                  disabled={isUpdatingCover}
                  onChange={(e) => setExtractPageNum(parseInt(e.target.value, 10) || 1)}
                  style={{
                    background: '#151515',
                    border: '1px solid #2f2f2f',
                    color: '#ffffff',
                    padding: '6px',
                    fontSize: '12px',
                    width: '60px',
                    textAlign: 'center',
                    outline: 'none',
                  }}
                />
                <button
                  disabled={isUpdatingCover}
                  onClick={() => handleExtractFromPage(customizingBook._id, extractPageNum)}
                  style={{
                    border: '1px solid #2f2f2f',
                    background: 'transparent',
                    color: '#ffffff',
                    padding: '6px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    flexGrow: 1,
                  }}
                >
                  Generate Cover
                </button>
              </div>
            </div>

            {/* Loading/status messages */}
            {coverStatus && (
              <div style={{
                background: '#151515',
                border: '1px solid #2f2f2f',
                padding: '10px',
                fontSize: '12px',
                color: '#888',
                textAlign: 'center',
              }}>
                {coverStatus}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
