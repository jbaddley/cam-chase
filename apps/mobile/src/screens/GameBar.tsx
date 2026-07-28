import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

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
        <Text style={styles.confirmTitle}>{isHost ? t('game.endTitle') : t('game.leaveTitle')}</Text>
        <Text style={styles.confirmBody}>{isHost ? t('game.endBody') : t('game.leaveBody')}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.confirmRow}>
          <Pressable onPress={() => setAsking(false)} style={styles.cancel}>
            <Text>{t('game.stay')}</Text>
          </Pressable>
          <Pressable onPress={isHost ? endForEveryone : leave} style={styles.danger}>
            <Text style={styles.dangerText}>
              {busy ? t('game.leaving') : isHost ? t('game.endConfirm') : t('game.leaveConfirm')}
            </Text>
          </Pressable>
        </View>
        {/* A host who wants out without ending everyone else's game. */}
        {isHost ? (
          <Pressable onPress={leave} style={styles.cancel}>
            <Text style={styles.quiet}>{t('game.justLeave')}</Text>
          </Pressable>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  code: { fontSize: 16, fontWeight: '700', letterSpacing: 2, color: '#495057' },
  exit: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#f1f3f5' },
  exitText: { fontSize: 14, color: '#495057' },
  confirm: { padding: 20, gap: 10 },
  confirmTitle: { fontSize: 20, fontWeight: '700' },
  confirmBody: { fontSize: 15, color: '#495057' },
  confirmRow: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#f1f3f5' },
  danger: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#ffc9c9' },
  dangerText: { color: '#a61e1e', fontWeight: '600' },
  quiet: { color: '#868e96', fontSize: 14 },
  error: { color: '#c92a2a' },
});
