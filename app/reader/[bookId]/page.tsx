import mongoose from 'mongoose';
import dynamic from 'next/dynamic';
import Script from 'next/script';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';

const ReaderComponent = dynamic(() => import('./ReaderComponent'), {
  ssr: false,
  loading: () => (
    <div style={{
      color: '#888',
      padding: '40px',
      fontSize: '14px',
      background: '#191919',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      Loading reader…
    </div>
  )
});

export default async function ReaderPage({ params }: { params: { bookId: string } }) {
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    console.error("ReaderPage: No session found, redirecting to /");
    redirect('/');
  }

  await connectDB();
  let book = null;
  try {
    const objectId = new mongoose.Types.ObjectId(params.bookId);
    book = await Book.findOne({
      _id: objectId,
      userId: session.user.id
    }).lean();
    console.log("ReaderPage looked up book:", params.bookId, "User:", session.user.id, "Found:", !!book);
  } catch (err) {
    console.error("ReaderPage DB Error casting/finding book:", err);
  }

  if (!book) {
    console.error("ReaderPage: Book not found, redirecting to /");
    redirect('/');
  }

  // Serialize Mongoose object properties safely for the client component
  const initialBook = {
    _id: String(book._id),
    r2Key: String(book.r2Key),
    title: String(book.title),
    currentPage: Number(book.currentPage ?? 1),
    totalPages: Number(book.totalPages ?? 0),
  };

  return (
    <>
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        strategy="beforeInteractive"
      />
      <ReaderComponent initialBook={initialBook} />
    </>
  );
}
