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

  /**
   * The invariant, rather than the one field that broke it: a POST policy
   * condition on `$Field` is only satisfiable if the signed form actually
   * carries `Field`. S3 does not treat a missing field as an unconstrained one —
   * it rejects the upload outright — so a condition without its field is not a
   * tighter rule, it is a guaranteed 403. The type condition shipped that way
   * and no photo could be uploaded at all.
   */
  it('carries a form field for every condition the policy names', async () => {
    const post = await media.createUploadPost(photoKey('g1', 't1', 'obj3'));
    const policy = JSON.parse(Buffer.from(post.fields.Policy!, 'base64').toString('utf8'));

    const named = (policy.conditions as unknown[])
      .filter((c): c is [string, string, string] => Array.isArray(c) && typeof c[1] === 'string' && c[1].startsWith('$'))
      .map((c) => c[1].slice(1));

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((field) => !(field in post.fields))).toEqual([]);
  });

  it('declares the image content type it constrains', async () => {
    const post = await media.createUploadPost(photoKey('g1', 't1', 'obj4'));
    // Keys are always `.jpg` and the camera produces JPEG, so the server pins
    // the type rather than trusting the client to state it.
    expect(post.fields['Content-Type']).toBe('image/jpeg');
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
