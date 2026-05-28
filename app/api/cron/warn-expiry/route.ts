import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';

const resend = new Resend(process.env.RESEND_API_KEY);

// Lightweight interface for NextAuth user documents stored in MongoDB
interface NextAuthUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  name?: string;
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    // NextAuth MongoDB adapter stores users in the 'users' collection
    const db = mongoose.connection.db;
    if (!db) return null;
    const user = await db
      .collection<NextAuthUser>('users')
      .findOne({ _id: new mongoose.Types.ObjectId(userId) });
    return user?.email ?? null;
  } catch {
    return null;
  }
}

function buildEmailHtml(
  bookTitle: string,
  currentPage: number,
  totalPages: number,
  bookId: string,
  expiresAt: Date
): string {
  const expiryDateStr = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const retainUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/books/${bookId}/retain`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e0e0e0;padding:32px;">
        <tr><td>
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">Your book expires in 7 days</h2>
          <p style="margin:0 0 24px;color:#555;font-size:14px;">
            We will automatically delete <strong>${bookTitle}</strong> on <strong>${expiryDateStr}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:1px solid #e0e0e0;padding:16px;margin-bottom:24px;">
            <tr>
              <td style="font-size:13px;color:#333;">
                <strong>Book:</strong> ${bookTitle}<br/>
                <strong>Progress:</strong> Page ${currentPage} of ${totalPages}
              </td>
            </tr>
          </table>
          <p style="margin:0 0 24px;color:#555;font-size:14px;">
            To keep this book in your library permanently, activate VIP access or re-upload the file before the expiry date.
          </p>
          <a href="${retainUrl}"
             style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;font-weight:600;">
            Keep this book →
          </a>
          <p style="margin:32px 0 0;font-size:12px;color:#aaa;">
            You received this email because you have an account on PDF Reader.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Find books expiring within the next 7 days that haven't been warned yet
  const expiringBooks = await Book.find({
    expiresAt: { $gte: now, $lte: in7Days },
    isVip: false,
    notified7Days: false,
  });

  let warned = 0;

  for (const book of expiringBooks) {
    try {
      const userEmail = await getUserEmail(book.userId);
      if (!userEmail) {
        console.warn(`No email found for userId ${book.userId}, skipping`);
        continue;
      }

      const bookId = String(book._id);

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
        to: userEmail,
        subject: 'Your book expires in 7 days',
        html: buildEmailHtml(
          book.title,
          book.currentPage,
          book.totalPages,
          bookId,
          book.expiresAt as Date
        ),
      });

      // Mark as warned so we don't send a duplicate
      await Book.findByIdAndUpdate(book._id, { notified7Days: true });
      warned++;
    } catch (err) {
      console.error(`Failed to warn for book ${String(book._id)}:`, err);
    }
  }

  console.log(`[warn-expiry] Sent warnings for ${warned} books`);
  return NextResponse.json({ warned });
}
