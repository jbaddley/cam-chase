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
    expect(width).toBe(1024);
    expect(height).toBe(1024); // square, so both sides hit the cap
    expect(resized.length).toBeLessThan(original.length);
  });

  /**
   * A chase is a comparison, and comparing a portrait original with a landscape
   * recreation penalises the pair for something neither player did wrong. Every
   * photo the game shows is square, so every derivative is cut to one.
   */
  it('centre-crops a landscape photo to a square', async () => {
    const { width, height } = await dimensionsOf(await resizeToFit(await makeJpeg(1600, 900), 1024));
    expect(width).toBe(height);
    // Bounded by the short side, then capped: min(900, 1024).
    expect(width).toBe(900);
  });

  it('centre-crops a portrait photo to the same square', async () => {
    const { width, height } = await dimensionsOf(await resizeToFit(await makeJpeg(900, 1600), 1024));
    expect(width).toBe(height);
    expect(width).toBe(900);
  });

  it('leaves an already-square photo square', async () => {
    const { width, height } = await dimensionsOf(await resizeToFit(await makeJpeg(800, 800), 1024));
    expect(width).toBe(800);
    expect(height).toBe(800);
  });

  it('crops a small image to square but never upscales it', async () => {
    const original = await makeJpeg(500, 400);
    const { width, height } = await dimensionsOf(await resizeToFit(original, 1024));
    // Cropped to the short side, and left there: 400 is well under the 1024 cap,
    // and stretching a small photo to fill it would invent detail.
    expect(width).toBe(400);
    expect(height).toBe(400);
  });
});
