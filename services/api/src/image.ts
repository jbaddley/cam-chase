import { Jimp } from 'jimp';

/**
 * Image resize core for the thumbnail pipeline (docs/04: downscale before AI
 * judging). Uses jimp (pure JS — bundles cleanly into a Lambda). sharp behind a
 * Lambda layer is the production speed optimization.
 */

export const THUMBNAIL_WIDTH = 1024;
const THUMB_PREFIX = 'thumbs/';

/** Key for a photo's resized variant: `thumbs/<width>/<originalKey>`. */
export function thumbnailKey(originalKey: string, width: number = THUMBNAIL_WIDTH): string {
  return `${THUMB_PREFIX}${width}/${originalKey}`;
}

/** True if a key is a thumbnail (so the handler skips its own output). */
export function isThumbnailKey(key: string): boolean {
  return key.startsWith(THUMB_PREFIX);
}

/**
 * Resize an image to fit within `maxDim` on its longest side, preserving aspect
 * ratio, and re-encode as JPEG. Images already within bounds are re-encoded
 * unchanged in dimensions.
 */
export async function resizeToFit(input: Buffer, maxDim: number = THUMBNAIL_WIDTH): Promise<Buffer> {
  const image = await Jimp.fromBuffer(input);
  if (image.width > maxDim || image.height > maxDim) {
    image.scaleToFit({ w: maxDim, h: maxDim });
  }
  return image.getBuffer('image/jpeg');
}
