import { Jimp } from 'jimp';
import type { S3Event } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { thumbnailKey } from './image.js';
import { handleObjectCreated, InMemoryObjectStore } from './image-handler.js';

function s3Event(...keys: string[]): S3Event {
  return {
    Records: keys.map((key) => ({ s3: { bucket: { name: 'photochase-photos-dev' }, object: { key } } })),
  } as S3Event;
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return new Jimp({ width, height, color: 0x00ff00ff }).getBuffer('image/jpeg');
}

let store: InMemoryObjectStore;
beforeEach(() => {
  store = new InMemoryObjectStore();
});

describe('handleObjectCreated', () => {
  it('writes a within-1024 thumbnail for an uploaded original', async () => {
    const key = 'games/g1/t1/obj.jpg';
    await store.put(key, await jpeg(1800, 1200), 'image/jpeg');

    const summary = await handleObjectCreated(store, s3Event(key));
    expect(summary).toEqual({ processed: 1, skipped: 0 });

    const thumb = await store.get(thumbnailKey(key));
    expect(thumb).not.toBeNull();
    const image = await Jimp.fromBuffer(thumb!);
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(1024);
  });

  it('skips thumbnail keys to avoid reprocessing', async () => {
    const summary = await handleObjectCreated(store, s3Event(thumbnailKey('games/g1/t1/obj.jpg')));
    expect(summary).toEqual({ processed: 0, skipped: 1 });
  });

  it('skips missing objects', async () => {
    const summary = await handleObjectCreated(store, s3Event('games/g1/t1/gone.jpg'));
    expect(summary).toEqual({ processed: 0, skipped: 1 });
  });

  it('decodes URL-encoded keys (spaces as +)', async () => {
    const realKey = 'games/g1/t1/my photo.jpg';
    await store.put(realKey, await jpeg(1200, 900), 'image/jpeg');

    const summary = await handleObjectCreated(store, s3Event('games/g1/t1/my+photo.jpg'));
    expect(summary.processed).toBe(1);
    expect(await store.get(thumbnailKey(realKey))).not.toBeNull();
  });
});
