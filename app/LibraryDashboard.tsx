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
}

interface MiniPDFPage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
}

interface MiniPDFDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<MiniPDFPage>;
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
      await uploadBook(selectedFile, detectedPages, {
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

  // Logic to allow closing modal if it hasn't uploaded yet OR if an error happened
  const hasUploadError = uploadStatus.startsWith('Error');
  const canCloseModal = !uploadProgress || hasUploadError;

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
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '24px',
          }}>
            {books.map((book) => {
              const pct = book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0;
              return (
                <div
                  key={book._id}
                  style={{
                    background: '#1e1e1e',
                    border: '1px solid #2f2f2f',
                    borderRadius: '8px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '160px',
                    position: 'relative',
                    transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.15)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#ffffff30';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#2f2f2f';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.15)';
                  }}
                >
                  {/* Top content */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Title & Actions Dropdown */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
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
                            background: '#151515',
                            border: '1px solid #ffffff30',
                            borderRadius: '4px',
                            color: '#ffffff',
                            fontSize: '15px',
                            padding: '4px 8px',
                            width: 'calc(100% - 24px)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            color: '#ffffff',
                            fontSize: '16px',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'block',
                            flexGrow: 1,
                            paddingRight: '28px',
                          }}
                          title={book.title}
                        >
                          {book.title}
                        </span>
                      )}

                      {editingBookId !== book._id && (
                        <div style={{ position: 'absolute', right: 0, top: 0 }}>
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
                              minWidth: '110px',
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '4px 0',
                            }}>
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

                    {/* Progress Info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#888' }}>
                      <span>📖 {book.currentPage} / {book.totalPages} pages</span>
                      <span>{pct}%</span>
                    </div>

                    {/* Thin Progress Bar */}
                    <div style={{ width: '100%', height: '6px', background: '#ffffff10', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #ffffff, #888888)',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>

                  {/* Resume Button */}
                  <div style={{ marginTop: '16px' }}>
                    <Link
                      href={`/reader/${book._id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#2a2a2a',
                        color: '#ffffff',
                        border: '1px solid #3f3f3f',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        textDecoration: 'none',
                        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#ffffff';
                        e.currentTarget.style.color = '#000000';
                        e.currentTarget.style.borderColor = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#2a2a2a';
                        e.currentTarget.style.color = '#ffffff';
                        e.currentTarget.style.borderColor = '#3f3f3f';
                      }}
                    >
                      Resume Reading
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
            if (canCloseModal) setIsModalOpen(false);
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
              {canCloseModal && (
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
              onClick={() => {
                if (!uploadProgress) fileInputRef.current?.click();
              }}
              style={{
                border: '1px dashed #2f2f2f',
                padding: '32px',
                textAlign: 'center',
                cursor: uploadProgress ? 'default' : 'pointer',
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
                disabled={!!uploadProgress}
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
    </>
  );
}
