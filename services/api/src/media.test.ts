import { describe, expect, it } from 'vitest';
import { makeS3Client, photoKey, S3MediaService } from './media.js';

const media = new S3MediaService(
  makeS3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' } }),
  'photochase-photos-dev',
);

describe('photoKey', () => {
  it('builds a game/team/object path', () => {
    expect(photoKey('g1', 't1', 'abc')).toBe('games/g1/t1/abc.jpg');
  });
});

describe('S3MediaService.createUploadPost', () => {
  it('scopes the presigned POST to the key with size and type conditions', async () => {
    const key = photoKey('g1', 't1', 'obj1');
    const post = await media.createUploadPost(key);
    expect(post.url).toContain('photochase-photos-dev');
    expect(post.fields.key).toBe(key);
    // The POST policy is present (encodes the conditions) and signed.
    expect(post.fields.Policy).toBeDefined();
    expect(post.fields['X-Amz-Signature']).toBeDefined();
  });

  it('honors a custom max size', async () => {
    const post = await media.createUploadPost(photoKey('g1', 't1', 'obj2'), { maxBytes: 1024 });
    const policy = JSON.parse(Buffer.from(post.fields.Policy!, 'base64').toString('utf8'));
    const rangeCondition = (policy.conditions as unknown[]).find(
      (c) => Array.isArray(c) && c[0] === 'content-length-range',
    ) as [string, number, number];
    expect(rangeCondition[2]).toBe(1024);
  });
});

describe('S3MediaService.createDownloadUrl', () => {
  it('returns a signed, key-scoped, expiring GET URL', async () => {
    const key = photoKey('g1', 't1', 'obj1');
    const url = await media.createDownloadUrl(key, 120);
    expect(url).toContain(key);
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires=120');
  });
});
