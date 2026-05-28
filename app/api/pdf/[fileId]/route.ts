import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';
import { s3Client, R2_BUCKET } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export async function GET(
  request: Request,
  { params }: { params: { fileId: string } }
) {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = params;
    if (!fileId) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    await connectDB();
    const book = await Book.findOne({
      _id: fileId,
      userId: session.user.id,
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: book.r2Key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No body returned from R2');
    }

    return new Response(response.Body as unknown as BodyInit, {
      headers: {
        'Content-Type': response.ContentType || 'application/pdf',
        'Content-Disposition': `inline; filename="${book.title}"`,
      },
    });
  } catch (error) {
    console.error('Error serving PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function HEAD(
  request: Request,
  { params }: { params: { fileId: string } }
) {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return new Response(null, { status: 401 });
    }

    const { fileId } = params;
    if (!fileId) {
      return new Response(null, { status: 400 });
    }

    await connectDB();
    const book = await Book.findOne({
      _id: fileId,
      userId: session.user.id,
    });

    if (!book) {
      return new Response(null, { status: 404 });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('Error in HEAD request:', error);
    return new Response(null, { status: 500 });
  }
}
