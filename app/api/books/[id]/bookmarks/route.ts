import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Bookmark } from '@/models/Bookmark';

// GET /api/books/[id]/bookmarks — Fetch all bookmarks for a book
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const bookmarks = await Bookmark.find({
      userId: session.user.id,
      bookId: params.id,
    })
      .sort({ pageNumber: 1 })
      .exec();

    return NextResponse.json(bookmarks);
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/books/[id]/bookmarks — Create or update a bookmark
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { pageNumber, note } = body;

    if (typeof pageNumber !== 'number' || pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    await connectDB();

    const bookmark = await Bookmark.findOneAndUpdate(
      {
        userId: session.user.id,
        bookId: params.id,
        pageNumber,
      },
      {
        userId: session.user.id,
        bookId: params.id,
        pageNumber,
        note: typeof note === 'string' ? note : '',
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );

    return NextResponse.json(bookmark);
  } catch (error) {
    console.error('Failed to save bookmark:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/books/[id]/bookmarks — Delete a bookmark
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { pageNumber } = body;

    if (typeof pageNumber !== 'number') {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
    }

    await connectDB();

    await Bookmark.findOneAndDelete({
      userId: session.user.id,
      bookId: params.id,
      pageNumber,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete bookmark:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
