import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
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
    const { code } = body as { code?: string };

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Invalid code' }, { status: 403 });
    }

    const vipCode = process.env.VIP_CODE ?? '';

    // Use timing-safe comparison to prevent timing attacks
    let isMatch = false;
    try {
      const submittedBuf = Buffer.from(code);
      const expectedBuf = Buffer.from(vipCode);
      // timingSafeEqual requires equal-length buffers
      if (submittedBuf.length === expectedBuf.length) {
        isMatch = timingSafeEqual(submittedBuf, expectedBuf);
      }
    } catch {
      isMatch = false;
    }

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 403 });
    }

    await connectDB();

    // Mark ALL books belonging to this user as VIP (never expire)
    await Book.updateMany(
      { userId: session.user.id },
      { $set: { isVip: true, expiresAt: null } }
    );

    return NextResponse.json({ success: true, message: 'VIP activated' });
  } catch (error) {
    console.error('VIP activation error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
