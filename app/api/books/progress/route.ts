import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { r2Key, currentPage, totalPages } = body;

    if (!r2Key || typeof currentPage !== 'number' || typeof totalPages !== 'number') {
      return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    await connectDB();

    const updatedBook = await Book.findOneAndUpdate(
      { userId: session.user.id, r2Key },
      {
        currentPage,
        totalPages,
        updatedAt: new Date(),
      },
      { returnDocument: 'after' }
    );

    if (!updatedBook) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json(updatedBook);
  } catch (error) {
    console.error('Progress update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
