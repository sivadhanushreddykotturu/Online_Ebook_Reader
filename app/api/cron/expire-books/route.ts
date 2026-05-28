import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';
import { deleteFromR2 } from '@/lib/r2';

export async function GET(request: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  const now = new Date();

  // Find all non-VIP books that have already been warned and are now expired
  const expiredBooks = await Book.find({
    expiresAt: { $lte: now },
    isVip: false,
    notified7Days: true,
  });

  let deleted = 0;

  for (const book of expiredBooks) {
    try {
      // Delete file from Cloudflare R2
      await deleteFromR2(book.r2Key);
      // Delete book document from MongoDB
      await Book.deleteOne({ _id: book._id });
      deleted++;
    } catch (err) {
      console.error(`Failed to delete expired book ${String(book._id)}:`, err);
    }
  }

  console.log(`[expire-books] Deleted ${deleted} expired books`);
  return NextResponse.json({ deleted });
}
