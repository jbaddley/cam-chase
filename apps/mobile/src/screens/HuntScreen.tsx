import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type HuntItemView, type HuntView } from '@photochase/client';
import { client } from '../api.js';
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
      <View style={styles.container}>
        <Text style={styles.title}>Hunt</Text>
        <Text style={styles.progress}>{error ?? 'Loading the hunt list…'}</Text>
      </View>
    );
  }

  const found = hunt.items.filter((i) => i.claimedPhotoId !== null).length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hunt</Text>
      <Text style={styles.progress}>
        {found} / {hunt.items.length} found
      </Text>
      <Text style={styles.rule}>Someone from your team has to be in the shot, pointing at it.</Text>
      {pending ? <Text style={styles.wildcardPending}>A wildcard item drops mid-round…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView>
        {hunt.items.map((item) => {
          const claimed = item.claimedPhotoId !== null;
          return (
            <Pressable
              key={item.itemId}
              onPress={() => claim(item)}
              style={claimed ? styles.itemFound : item.wildcard ? styles.itemWildcard : styles.item}
            >
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Text style={styles.itemMeta}>
                {claimed
                  ? 'Found'
                  : busyItemId === item.itemId
                    ? 'Saving…'
                    : item.wildcard
                      ? 'Wildcard — double points'
                      : item.rarity === 'rare'
                        ? 'Rare'
                        : 'Common'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  progress: { fontSize: 20, color: '#666' },
  rule: { fontSize: 14, color: '#666' },
  wildcardPending: { fontSize: 16, color: '#1971c2' },
  error: { color: '#c92a2a' },
  item: { backgroundColor: '#e9ecef', padding: 14, borderRadius: 10, marginBottom: 8 },
  itemFound: { backgroundColor: '#b2f2bb', padding: 14, borderRadius: 10, marginBottom: 8 },
  itemWildcard: { backgroundColor: '#ffd43b', padding: 14, borderRadius: 10, marginBottom: 8 },
  itemLabel: { fontSize: 18 },
  itemMeta: { fontSize: 14, color: '#495057' },
});
