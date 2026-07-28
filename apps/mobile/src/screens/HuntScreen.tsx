import { useCallback, useEffect, useState } from 'react';
import { ApiError, type HuntItemView, type HuntView } from '@photochase/client';
import { Pressable } from 'react-native';
import { client } from '../api.js';
import { Body, Card, ErrorText, Heading, Loading, Pill, Row, Screen, Title } from '../ui.js';
import { useViewfinder } from '../viewfinder.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Scavenger hunt capture: the list, what this team has already claimed, and the
 * wildcard that drops mid-round.
 *
 * Unlike a chase — where a photo is just the next of N — every shot here is
 * attached to the item it claims, so the flow is pick-then-shoot rather than
 * shoot-then-count. The "someone must be in frame pointing at it" rule is a
 * judging criterion, not something the app can check, so it is stated here and
 * enforced in the rating phase.
 */
export function HuntScreen({
  gameId,
  teamId,
  capture,
  now = Date.now,
}: {
  gameId: string;
  teamId: string;
  capture: CaptureSource;
  now?: () => number;
}) {
  useViewfinder();
  const [hunt, setHunt] = useState<HuntView | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<HuntView | null> => {
    try {
      const next = await client.listHuntItems(gameId);
      setHunt(next);
      return next;
    } catch {
      setError('Could not load the hunt list.');
      return null;
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The wildcard is withheld by the server until its reveal time, so the client
  // cannot show it early however it is prodded — it just has to come back and
  // ask once the moment arrives. One timer, not a poll: the time is known.
  const pending = hunt !== null && hunt.wildcardRevealAt !== null && !hunt.items.some((i) => i.wildcard);
  const revealAt = hunt?.wildcardRevealAt ?? null;
  useEffect(() => {
    if (!pending || revealAt === null) return;
    const timer = setTimeout(() => void refresh(), Math.max(0, revealAt - now()));
    return () => clearTimeout(timer);
  }, [pending, revealAt, refresh, now]);

  async function claim(item: HuntItemView): Promise<void> {
    if (busyItemId !== null || item.claimedPhotoId !== null) return;
    setBusyItemId(item.itemId);
    setError(null);
    try {
      const { file, location } = await capture();
      await client.capturePhoto(gameId, { teamId, location, file, itemId: item.itemId });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that photo. Try again.');
    } finally {
      setBusyItemId(null);
    }
  }

  if (!hunt) {
    return (
      <Loading title="Hunt" message={error ?? 'Loading the hunt list…'} />
    );
  }

  const found = hunt.items.filter((i) => i.claimedPhotoId !== null).length;

  return (
    <Screen scroll>
      <Title>Scavenger hunt</Title>
      <Body muted>
        {found} / {hunt.items.length} found
      </Body>
      <Body muted>Someone from your team has to be in the shot, pointing at it.</Body>
      {pending ? <Pill>A wildcard item drops mid-round…</Pill> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {hunt.items.map((item) => {
        const claimed = item.claimedPhotoId !== null;
        return (
          <Pressable key={item.itemId} onPress={() => claim(item)}>
            <Card tone={item.wildcard && !claimed ? 'highlight' : 'plain'}>
              <Row>
                <Heading>{item.label}</Heading>
                <Body muted>
                  {claimed
                    ? 'Found'
                    : busyItemId === item.itemId
                      ? 'Saving…'
                      : item.wildcard
                        ? 'Wildcard — double points'
                        : item.rarity === 'rare'
                          ? 'Rare'
                          : 'Common'}
                </Body>
              </Row>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

