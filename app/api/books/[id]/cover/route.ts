import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectDB } from '@/lib/mongodb';
import { Book } from '@/models/Book';
import { s3Client, R2_BUCKET, deleteFromR2 } from '@/lib/r2';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    await connectDB();

    const book = await Book.findOne({ _id: id, userId: session.user.id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!book.coverKey) {
      return NextResponse.json({ error: 'No cover available' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: book.coverKey,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No body returned from R2');
    }

    return new Response(response.Body as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error serving cover:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const formData = await request.formData();
    const coverFile = formData.get('cover') as File | null;

    if (!coverFile) {
      return NextResponse.json({ error: 'No cover file provided' }, { status: 400 });
    }

    await connectDB();
    const book = await Book.findOne({ _id: id, userId: session.user.id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Capture old coverKey to delete it later
    const oldCoverKey = book.coverKey;

    // Convert file to Buffer
    const buffer = Buffer.from(await coverFile.arrayBuffer());
    const cleanFilename = coverFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const newCoverKey = `covers/${session.user.id}/${Date.now()}-${cleanFilename}`;

    // Upload new cover to R2
    const putCommand = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: newCoverKey,
      Body: buffer,
      ContentType: 'image/jpeg',
      ContentLength: coverFile.size,
    });
    await s3Client.send(putCommand);

    // Save to Database and clear presets
    book.coverKey = newCoverKey;
    book.customCoverStyle = undefined;
    await book.save();

    // Delete old R2 cover file
    if (oldCoverKey) {
      try {
        await deleteFromR2(oldCoverKey);
      } catch (err) {
        console.error('Failed to delete old cover:', err);
      }
    }

    return NextResponse.json({ success: true, coverKey: newCoverKey });
  } catch (error) {
    console.error('Error uploading custom cover:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();
    const { presetId } = body;

    if (!presetId) {
      return NextResponse.json({ error: 'presetId is required' }, { status: 400 });
    }

    await connectDB();
    const book = await Book.findOne({ _id: id, userId: session.user.id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Capture old coverKey to delete it later
    const oldCoverKey = book.coverKey;

    // Save preset to DB and clear coverKey
    book.coverKey = undefined;
    book.customCoverStyle = presetId;
    await book.save();

    // Delete old R2 cover file
    if (oldCoverKey) {
      try {
        await deleteFromR2(oldCoverKey);
      } catch (err) {
        console.error('Failed to delete old cover:', err);
      }
    }

    return NextResponse.json({ success: true, customCoverStyle: presetId });
  } catch (error) {
    console.error('Error setting cover preset:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
