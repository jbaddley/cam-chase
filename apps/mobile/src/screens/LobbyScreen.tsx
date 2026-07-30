import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, type GameStateView, type TeamSummary } from '@photochase/client';
import { joinCodeUrl } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { QrCode } from '../QrCode.js';
import type { LocationSource } from '../location.js';
import { t } from '../i18n.js';
import { color, space, type as typeScale } from '../theme.js';
import { Body, Button, Card, ErrorText, Pill, Row, Screen } from '../ui.js';

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
  location,
  onStarted,
}: {
  game: GameStateView | null;
  code: string;
  isHost?: boolean;
  error?: string | null;
  /**
   * Read once, when the host starts: their fix becomes the spot teams check in
   * at on the way back. Optional so the lobby still renders without a device.
   */
  location?: LocationSource;
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
      /**
       * The host is standing with the teams — the instruction above says so — so
       * this fix is the meeting spot. A refusal is not fatal: the game starts
       * unfenced rather than not starting, because an unstartable game is a worse
       * failure than an unenforced return.
       */
      let startedFrom;
      try {
        startedFrom = await location?.current();
      } catch {
        startedFrom = undefined;
      }
      const { state } = await client.startGame(game.id, startedFrom ? { location: startedFrom } : {});
      onStarted?.(state);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Could not start the game.');
    } finally {
      setStarting(false);
    }
  }

  const shownError = startError ?? error ?? null;

  return (
    <Screen scroll>
      {/* The code is the biggest thing on the screen because it is the one
          thing being read aloud across a room. */}
      <View style={styles.codeBlock}>
        <Text style={styles.codeLabel}>{t('lobby.codeLabel')}</Text>
        <Text style={styles.code}>{code}</Text>
        {/* A QR to scan instead of reading six characters aloud — only while the
            game is still open to join. */}
        {game?.state === 'lobby' ? <QrCode value={joinCodeUrl(code)} testID="lobby-qr" /> : null}
      </View>

      <View style={styles.status}>
        <Pill>{game ? t(PHASE_KEY[game.state]) : t('watch.connecting')}</Pill>
        {/* Only the host's plan gates a game, so say so: it is the clearest
            reason a paying host has to bring more people in. */}
        {game && game.hostTier !== 'free' ? (
          <Pill tone="positive">{t('lobby.hostPlan', { tier: game.hostTier })}</Pill>
        ) : null}
      </View>

      <Body muted>{t('lobby.teamsJoined', { count: teams.length })}</Body>
      {shownError ? <ErrorText>{shownError}</ErrorText> : null}

      {teams.map((team) => (
        <Card key={team.teamId}>
          <Row>
            <Text style={styles.teamName}>{team.name}</Text>
            <Text style={styles.count}>{t('lobby.playerCount', { count: team.memberCount })}</Text>
          </Row>
        </Card>
      ))}
      {teams.length === 0 ? <Body muted>{t('lobby.waiting')}</Body> : null}

      {/* Said before the button, because pressing it is what records the spot. */}
      {isHost && game?.state === 'lobby' ? <Body muted>{t('host.gatherAtStart')}</Body> : null}

      {canStart ? (
        <Button onPress={start}>{starting ? t('game.starting') : t('game.start')}</Button>
      ) : isHost && game?.state === 'lobby' ? (
        <Button onPress={() => {}} disabled>
          {t('lobby.needMore')}
        </Button>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeBlock: { alignItems: 'center', paddingVertical: space.lg },
  codeLabel: { ...typeScale.label, color: color.inkMuted },
  code: { ...typeScale.display, color: color.ink, letterSpacing: 8 },
  status: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  teamName: { ...typeScale.heading, color: color.ink, flexShrink: 1 },
  count: { ...typeScale.label, color: color.inkMuted },
});
