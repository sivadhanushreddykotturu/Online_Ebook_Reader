import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { s3Client, R2_BUCKET } from '@/lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: 'Filename parameter is required' }, { status: 400 });
    }

    const cleanFilename = encodeURIComponent(filename.replace(/\s+/g, '_'));
    const r2Key = `books/${session.user.id}/${Date.now()}-${cleanFilename}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: 'application/pdf',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 900,
    });

    return NextResponse.json({ uploadUrl, r2Key });
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}