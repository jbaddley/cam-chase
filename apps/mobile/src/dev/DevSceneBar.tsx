import { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { joinCodeUrl } from '@photochase/shared';
import { fixturesAvailable } from './fixture-toggle.js';
import { DevScanContext } from '../viewfinder.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { IN_GAME, SCENES, currentScene, setScene, type FixtureScene } from './fixtures.js';

/** The code a pretend scan carries — the fixture game's, so it resolves under fixtures. */
const DEV_SCAN_CODE = 'DEV123';

/**
 * A strip for switching the fixture harness on and, once on, jumping between
 * scripted situations.
 *
 * Reaching "three teams, one still out, and the host looking at the gate" for
 * real takes two devices, a walk, and a deploy. Reaching it here takes one tap,
 * which is the difference between checking a layout and hoping about it.
 *
 * The harness itself is a runtime toggle now (see `fixture-toggle.ts`), and this
 * strip is where it is flipped: off, it is a single chip; on, it expands to the
 * scene chips. Present in any development bundle so the switch is always
 * reachable, but stripped from a release bundle — {@link fixturesAvailable} is
 * `__DEV__`, so nothing here can appear in a build a player could install.
 *
 * Not styled to match the app on purpose: it should look like scaffolding, so
 * nobody screenshots it for a design review and nobody mistakes it for a feature.
 */
export function DevSceneBar({
  enabled,
  onToggle,
  inGame,
  onEnterGame,
  onLeaveGame,
}: {
  /** Whether the harness is currently answering requests. */
  enabled?: boolean;
  /** Flip the harness on or off. */
  onToggle?: () => void;
  /** Whether the app is currently showing a game. */
  inGame?: boolean;
  onEnterGame?: () => void;
  onLeaveGame?: () => void;
} = {}) {
  const [, force] = useState(0);
  const fireScan = useContext(DevScanContext);
  if (!fixturesAvailable()) return null;

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
      <Pressable onPress={() => onToggle?.()} testID="dev-fixtures-toggle">
        <Text style={[styles.label, enabled ? styles.labelOn : styles.labelOff]}>
          {enabled ? 'FIXTURES ON' : 'FIXTURES OFF'}
        </Text>
      </Pressable>
      {/* The scene chips only mean anything while the harness is answering. */}
      {enabled ? (
        <ScrollView horizontal contentContainerStyle={styles.row}>
          {/* Out of the game, so the home, plan, league and referral routes can be
              reached at all — the harness drops you straight into a game. */}
          <Pressable onPress={() => onLeaveGame?.()} testID="dev-scene-exit">
            <Text style={[styles.chip, !inGame && styles.chipOn]}>{inGame ? 'leave' : 'out'}</Text>
          </Pressable>
          {/* Fires a synthetic QR scan at the join scanner, so join-by-scan is
              exercisable in the emulator with no code to point at. Inert unless a
              screen is actually scanning. */}
          <Pressable onPress={() => fireScan(joinCodeUrl(DEV_SCAN_CODE))} testID="dev-scan">
            <Text style={styles.chip}>scan</Text>
          </Pressable>
          {SCENES.map((s) => (
            <Pressable key={s} onPress={() => pick(s)} testID={`dev-scene-${s}`}>
              <Text style={[styles.chip, inGame && s === currentScene() && styles.chipOn]}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#111', paddingVertical: space.xs, paddingHorizontal: space.sm, gap: space.xs },
  label: { ...typeScale.label, fontSize: 10 },
  labelOn: { color: '#0f0' },
  labelOff: { color: '#f55' },
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
