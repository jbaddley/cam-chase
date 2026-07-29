import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEV_FIXTURES } from '../config.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { IN_GAME, SCENES, currentScene, setScene, type FixtureScene } from './fixtures.js';

/**
 * A strip for jumping between scripted situations while the fixtures are on.
 *
 * Reaching "three teams, one still out, and the host looking at the gate" for
 * real takes two devices, a walk, and a deploy. Reaching it here takes one tap,
 * which is the difference between checking a layout and hoping about it.
 *
 * Renders nothing at all unless {@link DEV_FIXTURES} is set, so it cannot appear
 * in a build a player could install — and `__DEV__` is half of that flag, so it
 * is stripped from any release bundle regardless of the environment.
 *
 * Not styled to match the app on purpose: it should look like scaffolding, so
 * nobody screenshots it for a design review and nobody mistakes it for a feature.
 */
export function DevSceneBar({
  inGame,
  onEnterGame,
  onLeaveGame,
}: {
  /** Whether the app is currently showing a game. */
  inGame?: boolean;
  onEnterGame?: () => void;
  onLeaveGame?: () => void;
} = {}) {
  const [, force] = useState(0);
  if (!DEV_FIXTURES) return null;

  const pick = (s: FixtureScene) => {
    setScene(s);
    // Picking a game phase puts you in a game, whether or not you were in one.
    // Without this, leaving to look at the home routes was a one-way trip: the
    // only way back in is a join code, and the harness answers no such request.
    if (IN_GAME.includes(s)) onEnterGame?.();
    // The polls pick the new scene up on their next tick; this just repaints the
    // strip so the selected chip is right immediately.
    force((n) => n + 1);
  };

  return (
    <View style={styles.bar}>
      <Text style={styles.label}>FIXTURES</Text>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {/* Out of the game, so the home, plan, league and referral routes can be
            reached at all — the harness drops you straight into a game. */}
        <Pressable onPress={() => onLeaveGame?.()} testID="dev-scene-exit">
          <Text style={[styles.chip, !inGame && styles.chipOn]}>{inGame ? 'leave' : 'out'}</Text>
        </Pressable>
        {SCENES.map((s) => (
          <Pressable key={s} onPress={() => pick(s)} testID={`dev-scene-${s}`}>
            <Text style={[styles.chip, inGame && s === currentScene() && styles.chipOn]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#111', paddingVertical: space.xs, paddingHorizontal: space.sm, gap: space.xs },
  label: { ...typeScale.label, color: '#0f0', fontSize: 10 },
  row: { flexDirection: 'row', gap: space.xs },
  chip: {
    ...typeScale.label,
    fontSize: 11,
    color: '#aaa',
    backgroundColor: '#222',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  chipOn: { color: color.ink, backgroundColor: '#0f0' },
});
