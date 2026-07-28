import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, ErrorText, Heading } from '../ui.js';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { color, radius, space, type as typeScale } from '../theme.js';

/**
 * A bar across the top of every in-game screen: the code you are playing under,
 * and the way out.
 *
 * The way out is the point. Before this there was none — joining a game
 * replaced the whole app with the game, and nothing put it back. A player who
 * joined the wrong code, or whose host never started, had to force-quit.
 *
 * Leaving means two different things, so it asks which:
 *  - in the lobby, it really leaves — the membership goes, and an emptied team
 *    with it, so the host is not left waiting for someone who has gone;
 *  - once play has started the membership stays, because photos and votes are
 *    already attached to it, and this just stops showing you the game.
 *
 * The host gets a third option instead of the first: ending it for everybody.
 */
export function GameBar({
  gameId,
  code,
  isHost,
  inLobby,
  onExit,
}: {
  gameId: string;
  code: string;
  isHost: boolean;
  inLobby: boolean;
  onExit: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Only the lobby has anything to undo server-side; later, walking away is
      // a local act and what you already did still counts.
      if (inLobby && !isHost) await client.leaveGame(gameId);
      onExit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('game.leaveFailed'));
      setBusy(false);
    }
  }

  async function endForEveryone(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.abandonGame(gameId);
      onExit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('game.endFailed'));
      setBusy(false);
    }
  }

  if (asking) {
    return (
      <View style={styles.confirm}>
        <Heading>{isHost ? t('game.endTitle') : t('game.leaveTitle')}</Heading>
        <Body muted>{isHost ? t('game.endBody') : t('game.leaveBody')}</Body>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <View style={styles.confirmRow}>
          <View style={styles.half}>
            <Button onPress={() => setAsking(false)} tone="secondary">
              {t('game.stay')}
            </Button>
          </View>
          <View style={styles.half}>
            <Button onPress={isHost ? endForEveryone : leave} tone="danger">
              {busy ? t('game.leaving') : isHost ? t('game.endConfirm') : t('game.leaveConfirm')}
            </Button>
          </View>
        </View>
        {/* A host who wants out without ending everyone else's game. */}
        {isHost ? (
          <Button onPress={leave} tone="secondary">
            {t('game.justLeave')}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      <Text style={styles.code}>{code}</Text>
      <Pressable onPress={() => setAsking(true)} style={styles.exit} accessibilityLabel={t('game.exit')}>
        <Text style={styles.exitText}>{t('game.exit')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  code: { ...typeScale.heading, letterSpacing: 4, color: color.inkMuted },
  exit: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSunken,
  },
  exitText: { ...typeScale.label, color: color.inkMuted },
  confirm: { padding: space.xl, gap: space.md },
  confirmRow: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});
