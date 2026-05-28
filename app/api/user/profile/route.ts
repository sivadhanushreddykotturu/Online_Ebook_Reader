import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { User } from '@/models/User';

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user || (!session.user.id && !session.user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const email = session.user.email?.toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: 'User email not found in session' }, { status: 400 });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ image: user.image });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
