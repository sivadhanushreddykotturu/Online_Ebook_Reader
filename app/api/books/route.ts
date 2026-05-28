import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';

export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const books = await Book.find({
      userId: session.user.id,
      r2Key: { $exists: true, $ne: null },
    })
      .sort({ updatedAt: -1 })
      .exec();

    return NextResponse.json(books);
  } catch (error) {
    console.error('Failed to fetch books:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
