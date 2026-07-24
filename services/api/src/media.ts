import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Photo media access via short-lived presigned URLs (docs/02, docs/07). Uploads
 * use a presigned POST so the client's write is constrained to one key, an
 * image content-type, and a size limit; reads use a presigned GET. The bucket
 * stays private — no public access.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_EXPIRES_SECONDS = 300;

/** Deterministic object key for a game photo. */
export function photoKey(gameId: string, teamId: string, objectId: string): string {
  return `games/${gameId}/${teamId}/${objectId}.jpg`;
}

export interface UploadOptions {
  maxBytes?: number;
  expiresIn?: number;
}

export interface MediaService {
  /** Presigned POST scoped to `key`, enforcing image type and size. */
  createUploadPost(key: string, opts?: UploadOptions): Promise<PresignedPost>;
  /** Presigned GET URL for reading `key`. */
  createDownloadUrl(key: string, expiresIn?: number): Promise<string>;
}

export class S3MediaService implements MediaService {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async createUploadPost(key: string, opts: UploadOptions = {}): Promise<PresignedPost> {
    return createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, opts.maxBytes ?? MAX_UPLOAD_BYTES],
        ['starts-with', '$Content-Type', 'image/'],
      ],
      Expires: opts.expiresIn ?? DEFAULT_EXPIRES_SECONDS,
    });
  }

  async createDownloadUrl(key: string, expiresIn: number = DEFAULT_EXPIRES_SECONDS): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }
}

/**
 * Build an S3 client. Omit `credentials` in AWS to use the default chain; pass
 * them (and optionally an `endpoint`) for tests or local emulators.
 */
export function makeS3Client(opts: {
  region?: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} = {}): S3Client {
  return new S3Client({
    region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
    ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
    ...(opts.credentials ? { credentials: opts.credentials } : {}),
  });
}
