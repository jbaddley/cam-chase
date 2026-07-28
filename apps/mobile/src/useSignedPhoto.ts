import { useEffect, useState } from 'react';
import { client } from './api.js';

/**
 * Signed URLs last five minutes; this re-mints at four so one never expires
 * while it is still on screen.
 */
const REFRESH_MS = 240_000;

/**
 * A displayable URL for a stored photo, kept fresh for as long as it is shown.
 *
 * The refresh is the whole reason this is a hook rather than a field on
 * `AssignmentView`. `listAssignments` runs once on mount, so a URL minted there
 * is dead five minutes into a round that takes fifteen — and the failure would
 * present as "the original sometimes doesn't load", which is a miserable thing
 * to chase. Round 2 is exactly the case: you look at one photo for as long as it
 * takes to walk somewhere and line the shot up.
 *
 * Asks for the 1024px thumbnail. That is ample for matching a composition, and
 * the original is allowed to be 10 MB — which a team would pay for on cellular,
 * outdoors, once per assignment, again on every refresh. `retriedFull` is the
 * fallback: thumbnails are written by an S3-triggered Lambda, so a photo taken
 * seconds ago may not have one yet, and one retry without the variant covers it.
 */
export function useSignedPhoto(
  gameId: string,
  photoId: string | null,
): { uri: string | null; failed: boolean; retryFull: () => void } {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  // A new photo is a new subject: drop the old URL rather than leaving the
  // previous original on screen under the next assignment's caption.
  useEffect(() => {
    setUri(null);
    setFailed(false);
    setFull(false);
  }, [photoId]);

  useEffect(() => {
    if (photoId === null) return;
    let active = true;

    async function sign(): Promise<void> {
      try {
        const { url } = await client.requestDownload(gameId, photoId!, full ? {} : { variant: 'thumb' });
        if (!active) return;
        setUri(url);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    }

    void sign();
    const timer = setInterval(() => void sign(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameId, photoId, full]);

  return {
    uri,
    failed,
    /** Called when the image itself fails to load — usually a missing thumbnail. */
    retryFull: () => setFull(true),
  };
}
