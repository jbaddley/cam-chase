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
 * Centre-crop to a square, then size to `maxDim`, and re-encode as JPEG.
 *
 * Square because a chase is a comparison, and comparing a portrait original with
 * a landscape recreation penalises the pair for something that has nothing to do
 * with how well either was framed. Every photo the game shows is square, so every
 * derivative is cut to one here.
 *
 * Centre, because the app frames a centred square: the preview is a square window
 * in the middle of its half of the screen, so the middle of the captured frame is
 * what the player was looking at.
 *
 * Honest limit: this is close to what the player saw, not identical to it. The
 * preview square and the sensor frame are different rectangles, so a centred crop
 * of the capture and the centred square on screen agree on the subject and can
 * disagree at the edges. Making them the same needs the crop to happen on the
 * device, against the preview's own geometry — `expo-image-manipulator`, and a
 * prebuild. Worth doing when edge-exactness starts mattering; not before.
 */
export async function resizeToFit(input: Buffer, maxDim: number = THUMBNAIL_WIDTH): Promise<Buffer> {
  const image = await Jimp.fromBuffer(input);

  const side = Math.min(image.width, image.height);
  if (image.width !== image.height) {
    image.crop({
      x: Math.round((image.width - side) / 2),
      y: Math.round((image.height - side) / 2),
      w: side,
      h: side,
    });
  }

  if (image.width > maxDim) image.scaleToFit({ w: maxDim, h: maxDim });
  return image.getBuffer('image/jpeg');
}
