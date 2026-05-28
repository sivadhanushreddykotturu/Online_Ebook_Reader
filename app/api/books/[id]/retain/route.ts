import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';

const resend = new Resend(process.env.RESEND_API_KEY);

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    const user = await db
      .collection<{ _id: mongoose.Types.ObjectId; email: string }>('users')
      .findOne({ _id: new mongoose.Types.ObjectId(userId) });
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  await connectDB();

  const book = await Book.findOne({
    _id: params.id,
    userId: session.user.id,
  });

  if (!book) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Reset expiry: 60 days from now, clear warning flag
  const newExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  await Book.findByIdAndUpdate(params.id, {
    expiresAt: newExpiresAt,
    notified7Days: false,
  });

  // Send confirmation email (best-effort — don't block the redirect on failure)
  try {
    const userEmail = await getUserEmail(session.user.id);
    if (userEmail) {
      const expiryDateStr = newExpiresAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
        to: userEmail,
        subject: 'Book retained ✓',
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e0e0e0;padding:32px;">
        <tr><td>
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">Book retained ✓</h2>
          <p style="margin:0 0 16px;color:#555;font-size:14px;">
            <strong>${book.title}</strong> has been kept for another 60 days.
          </p>
          <p style="margin:0;color:#888;font-size:13px;">
            New expiry date: <strong>${expiryDateStr}</strong>
          </p>
          <p style="margin:32px 0 0;font-size:12px;color:#aaa;">
            You received this email because you have an account on PDF Reader.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      });
    }
  } catch (err) {
    // Log but don't fail — the retain already succeeded
    console.error('Failed to send retain confirmation email:', err);
  }

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
