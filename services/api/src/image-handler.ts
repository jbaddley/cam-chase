import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import { makeS3Client } from './media.js';
import { isThumbnailKey, resizeToFit, thumbnailKey } from './image.js';

/**
 * Object storage port for the resize pipeline. In-memory for tests; S3 in prod.
 */
export interface ObjectStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  has(key: string): boolean {
    return this.objects.has(key);
  }
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null; // NoSuchKey and friends
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

/** S3 event object keys are URL-encoded (spaces as `+`). */
export function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

export interface ResizeSummary {
  processed: number;
  skipped: number;
}

/**
 * For each S3 object-created record: skip thumbnails (avoid recursion) and
 * missing objects, otherwise resize the original and write the `thumbs/<width>/`
 * variant. Idempotent — re-running overwrites the same thumbnail key.
 */
export async function handleObjectCreated(store: ObjectStore, event: S3Event): Promise<ResizeSummary> {
  let processed = 0;
  let skipped = 0;
  for (const record of event.Records) {
    const key = decodeS3Key(record.s3.object.key);
    if (isThumbnailKey(key)) {
      skipped++;
      continue;
    }
    const original = await store.get(key);
    if (!original) {
      skipped++;
      continue;
    }
    const thumb = await resizeToFit(original);
    await store.put(thumbnailKey(key), thumb, 'image/jpeg');
    processed++;
  }
  return { processed, skipped };
}

/** Lambda entrypoint for S3 object-created events on the photo bucket. */
export async function resizeHandler(event: S3Event): Promise<ResizeSummary> {
  const bucket = process.env.PHOTO_BUCKET;
  if (!bucket) throw new Error('PHOTO_BUCKET is not configured.');
  const store = new S3ObjectStore(makeS3Client({ region: process.env.AWS_REGION }), bucket);
  return handleObjectCreated(store, event);
}
