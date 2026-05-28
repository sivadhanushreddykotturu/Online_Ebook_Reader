import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { User } from '@/models/User';

export async function POST() {
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

    const seed = Math.random().toString(36).substring(2, 8);
    const newAvatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}&backgroundColor=transparent`;

    user.image = newAvatarUrl;
    await user.save();

    return NextResponse.json({ success: true, image: newAvatarUrl });
  } catch (error) {
    console.error('Change avatar error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
