import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';
import { isThumbnailKey, resizeToFit, THUMBNAIL_WIDTH, thumbnailKey } from './image.js';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return new Jimp({ width, height, color: 0xff0000ff }).getBuffer('image/jpeg');
}

async function dimensionsOf(buffer: Buffer): Promise<{ width: number; height: number }> {
  const image = await Jimp.fromBuffer(buffer);
  return { width: image.width, height: image.height };
}

describe('thumbnailKey / isThumbnailKey', () => {
  it('derives a thumbs/<width>/ key', () => {
    expect(thumbnailKey('games/g1/t1/obj.jpg')).toBe(`thumbs/${THUMBNAIL_WIDTH}/games/g1/t1/obj.jpg`);
  });

  it('detects thumbnail keys', () => {
    expect(isThumbnailKey(thumbnailKey('games/g1/t1/obj.jpg'))).toBe(true);
    expect(isThumbnailKey('games/g1/t1/obj.jpg')).toBe(false);
  });
});

describe('resizeToFit', () => {
  it('scales a large image to within the max dimension and shrinks the file', async () => {
    const original = await makeJpeg(2000, 1500);
    const resized = await resizeToFit(original, 1024);
    const { width, height } = await dimensionsOf(resized);
    expect(width).toBeLessThanOrEqual(1024);
    expect(height).toBeLessThanOrEqual(1024);
    expect(width).toBe(1024); // longest side hits the cap
    expect(resized.length).toBeLessThan(original.length);
  });

  it('leaves a small image within bounds (no upscale)', async () => {
    const original = await makeJpeg(500, 400);
    const { width, height } = await dimensionsOf(await resizeToFit(original, 1024));
    expect(width).toBe(500);
    expect(height).toBe(400);
  });
});
