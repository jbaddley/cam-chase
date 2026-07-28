import { useEffect, type ReactNode } from 'react';
import type { GameMode } from '@photochase/shared';
import { StyleSheet, View } from 'react-native';
import { CaptureScreen, type CaptureSource } from './screens/CaptureScreen.js';
import { GameBar } from './screens/GameBar.js';
import { ChaseScreen } from './screens/ChaseScreen.js';
import { ColorShootScreen } from './screens/ColorShootScreen.js';
import { FinalsScreen } from './screens/FinalsScreen.js';
import { GuessScreen } from './screens/GuessScreen.js';
import { HuntScreen } from './screens/HuntScreen.js';
import type { JoinedGame } from './screens/JoinScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { RatingScreen } from './screens/RatingScreen.js';
import { ResultsScreen } from './screens/ResultsScreen.js';
import { ReturnScreen } from './screens/ReturnScreen.js';
import { TagScreen } from './screens/TagScreen.js';
import { useGamePhase } from './useGamePhase.js';

/**
 * Screen selection for a joined game, driven by the polled phase **and mode**.
 *
 * Each mode has its own flow, so the same state name means different things:
 * `round1_active` is shooting originals in a chase, claiming list items in a
 * hunt, and shooting a secret attribute in a colour hunt. Dispatching on state
 * alone — as this did before the modes shipped — would have shown chase screens
 * to every mode.
 *
 * Phases the modes share stay shared: rating, finals and results are one screen
 * each, with the results breakdown relabelled per mode.
 */
export function GameRouter({
  joined,
  capture,
  onExit,
}: {
  joined: JoinedGame;
  capture: CaptureSource;
  onExit: () => void;
}) {
  const { game, error, applyState } = useGamePhase(joined.gameId);
  const onTeam = joined.teamId !== null;
  const isHost = joined.role === 'host';
  const mode: GameMode = game?.config.mode ?? 'photo_chase';

  // Archived means somebody ended it. There is nothing left to show, and
  // sitting on a dead game is the trap this whole bar exists to avoid.
  useEffect(() => {
    if (game?.state === 'archived') onExit();
  }, [game?.state, onExit]);

  /** Every screen gets the bar, so there is always a way out. */
  const framed = (screen: ReactNode) => (
    <View style={styles.screen}>
      <GameBar
        gameId={joined.gameId}
        code={joined.code}
        isHost={isHost}
        inLobby={game?.state === 'lobby' || game === null}
        onExit={onExit}
      />
      <View style={styles.body}>{screen}</View>
    </View>
  );

  const lobby = (
    <LobbyScreen game={game} code={joined.code} isHost={isHost} error={error} onStarted={applyState} />
  );

  if (!game) return framed(lobby);

  // --- shared tail: every mode ends the same way -----------------------------

  if (game.state === 'rating') {
    // Judges and spectators rate too, so this is not gated on team membership.
    return framed(<RatingScreen gameId={joined.gameId} />);
  }
  if (game.state === 'finals_voting') {
    return framed(<FinalsScreen gameId={joined.gameId} myTeamId={joined.teamId} />);
  }
  if (game.state === 'results' || game.state === 'archived') {
    return framed(<ResultsScreen gameId={joined.gameId} teams={game.teams} mode={mode} />);
  }

  // --- per-mode play ---------------------------------------------------------

  if (mode === 'photo_tag') {
    if (!onTeam) return framed(lobby); // judges and spectators do not chase anyone
    if (game.state === 'scatter' || game.state === 'tag_active') {
      return framed(
        <TagScreen
          gameId={joined.gameId}
          teams={game.teams}
          scattering={game.state === 'scatter'}
          capture={capture}
        />,
      );
    }
    return framed(lobby);
  }

  if (mode === 'color_hunt') {
    if (game.state === 'guessing') return framed(<GuessScreen gameId={joined.gameId} />);
    if (onTeam && game.state === 'round1_active') {
      return framed(
        <ColorShootScreen
          gameId={joined.gameId}
          teamId={joined.teamId!}
          quota={game.config.photosPerRound}
          capture={capture}
        />,
      );
    }
    return framed(lobby);
  }

  if (mode === 'scavenger_hunt') {
    if (onTeam && game.state === 'round1_active') {
      return framed(<HuntScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />);
    }
    if (onTeam && game.state === 'round1_return') {
      return framed(<ReturnScreen gameId={joined.gameId} round={1} capture={capture} />);
    }
    return framed(lobby);
  }

  // --- photo_chase -----------------------------------------------------------

  if (onTeam && game.state === 'round1_active') {
    return framed(
      <CaptureScreen
        gameId={joined.gameId}
        teamId={joined.teamId!}
        quota={game.config.photosPerRound}
        capture={capture}
      />,
    );
  }
  if (onTeam && game.state === 'round2_active') {
    return framed(<ChaseScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />);
  }
  if (onTeam && (game.state === 'round1_return' || game.state === 'round2_return')) {
    return framed(
      <ReturnScreen gameId={joined.gameId} round={game.state === 'round1_return' ? 1 : 2} capture={capture} />,
    );
  }

  return framed(lobby);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
});
