import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';
import { s3Client, R2_BUCKET } from '@/lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;
    const totalPagesStr = formData.get('totalPages') as string | null;

    if (!file || !title || !totalPagesStr) {
      return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
    }

    const totalPages = parseInt(totalPagesStr, 10);
    if (isNaN(totalPages)) {
      return NextResponse.json({ error: 'Invalid totalPages' }, { status: 400 });
    }

    await connectDB();

    const bookCount = await Book.countDocuments({ userId: session.user.id });
    if (bookCount >= 20) {
      return NextResponse.json(
        { error: 'Library limit reached. Maximum of 20 books allowed.' },
        { status: 400 }
      );
    }

    const cleanFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const r2Key = `books/${session.user.id}/${Date.now()}-${cleanFilename}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
      ContentType: 'application/pdf',
      ContentLength: file.size,
    });

    await s3Client.send(command);

    const newBook = await Book.create({
      userId: session.user.id,
      r2Key,
      title,
      currentPage: 1,
      totalPages,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      isVip: false,
    });

    return NextResponse.json(newBook, { status: 201 });
  } catch (error) {
    console.error('Save book error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}