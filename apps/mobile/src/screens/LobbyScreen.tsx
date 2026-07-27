import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type GameStateView, type TeamSummary } from '@photochase/client';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { t } from '../i18n.js';

export type LobbyTeam = TeamSummary;

const MIN_TEAMS = 2;

/** Catalog key for each game phase, so the header follows the active locale. */
const PHASE_KEY = {
  draft: 'phase.draft',
  lobby: 'phase.lobby',
  round1_active: 'phase.round1Active',
  round1_return: 'phase.round1Return',
  round2_active: 'phase.round2Active',
  round2_return: 'phase.round2Return',
  guessing: 'phase.guessing',
  scatter: 'phase.scatter',
  tag_active: 'phase.tagActive',
  rating: 'phase.rating',
  finals_voting: 'phase.finalsVoting',
  results: 'phase.results',
  archived: 'phase.archived',
} as const satisfies Record<GameStateView['state'], MessageKey>;

/**
 * Roster and phase display. The game state is polled by the app root and passed
 * in, so every screen agrees on the current phase. The host sees a Start control
 * once ≥2 teams have joined.
 */
export function LobbyScreen({
  game,
  code,
  isHost = false,
  error,
  onStarted,
}: {
  game: GameStateView | null;
  code: string;
  isHost?: boolean;
  error?: string | null;
  /** Called with the new state after the host starts the game. */
  onStarted?: (state: GameStateView['state']) => void;
}) {
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const teams = game?.teams ?? [];
  const canStart = isHost && game?.state === 'lobby' && teams.length >= MIN_TEAMS;

  async function start(): Promise<void> {
    if (!game) return;
    setStarting(true);
    setStartError(null);
    try {
      const { state } = await client.startGame(game.id);
      onStarted?.(state);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Could not start the game.');
    } finally {
      setStarting(false);
    }
  }

  const shownError = startError ?? error ?? null;

  return (
    <View style={styles.container}>
      <Text style={styles.code}>{t('lobby.code', { code })}</Text>
      <Text style={styles.phase}>{game ? t(PHASE_KEY[game.state]) : t('watch.connecting')}</Text>
      <Text style={styles.subtitle}>{t('lobby.teamsJoined', { count: teams.length })}</Text>
      {/* Only the host's plan gates a game, so say so: it is the clearest
          reason a paying host has to bring more people in. */}
      {game && game.hostTier !== 'free' ? (
        <Text style={styles.perk}>{t('lobby.hostPlan', { tier: game.hostTier })}</Text>
      ) : null}
      {shownError ? <Text style={styles.error}>{shownError}</Text> : null}
      <ScrollView>
        {teams.map((team) => (
          <View key={team.teamId} style={styles.row}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Text>{t('lobby.playerCount', { count: team.memberCount })}</Text>
          </View>
        ))}
      </ScrollView>
      {canStart ? (
        <Pressable onPress={start} style={styles.button}>
          <Text>{starting ? t('game.starting') : t('game.start')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  code: { fontSize: 24, fontWeight: '700' },
  phase: { fontSize: 18, color: '#1971c2' },
  subtitle: { color: '#666' },
  perk: { color: '#2f9e44' },
  error: { color: '#c92a2a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  teamName: { fontSize: 18 },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
});
