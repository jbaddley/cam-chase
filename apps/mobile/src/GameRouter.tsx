import { useEffect, useState, type ReactNode } from 'react';
import type { GameMode } from '@photochase/shared';
import { StyleSheet, View } from 'react-native';
import { HideChromeContext } from './chrome.js';
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
import { useRegroup } from './useRegroup.js';
import type { LocationSource } from './location.js';

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
/** Phases where somebody might be walking back, so the roster is worth polling. */
const REGROUP_STATES = new Set(['round1_active', 'round1_return', 'round2_active', 'round2_return']);

export function GameRouter({
  joined,
  capture,
  location,
  onExit,
}: {
  joined: JoinedGame;
  capture: CaptureSource;
  location: LocationSource;
  onExit: () => void;
}) {
  const { game, error, applyState } = useGamePhase(joined.gameId);
  // A screen (Round 2 fullscreen) can ask to hide the bar so the picture owns
  // the whole screen. Held here because the bar is drawn here.
  const [chromeHidden, setChromeHidden] = useState(false);
  const onTeam = joined.teamId !== null;
  const isHost = joined.role === 'host';
  const mode: GameMode = game?.config.mode ?? 'photo_chase';
  const { regroup, error: regroupError, refresh } = useRegroup(
    joined.gameId,
    game !== null && REGROUP_STATES.has(game.state),
  );
  /**
   * Whether this team still owes work. Server-derived, so it survives a restart —
   * `CaptureScreen`'s own count is local state and resets to zero on a force-quit.
   */
  const stillWorking = regroup?.me?.status === 'shooting';

  /** The regroup screen, which both players and the host land on. */
  const regrouping = (
    <ReturnScreen
      gameId={joined.gameId}
      mode={mode}
      isHost={isHost}
      regroup={regroup}
      error={regroupError}
      location={location}
      refresh={refresh}
      onAdvanced={applyState}
    />
  );

  // Archived means somebody ended it. There is nothing left to show, and
  // sitting on a dead game is the trap this whole bar exists to avoid.
  useEffect(() => {
    if (game?.state === 'archived') onExit();
  }, [game?.state, onExit]);

  /**
   * Every screen gets the bar, so there is always a way out — except when a
   * screen has gone fullscreen and asked for it to step aside (see
   * {@link HideChromeContext}). The provider wraps the screen so it can ask.
   */
  const framed = (screen: ReactNode) => (
    <HideChromeContext.Provider value={setChromeHidden}>
      <View style={styles.screen}>
        {chromeHidden ? null : (
          <GameBar
            gameId={joined.gameId}
            code={joined.code}
            isHost={isHost}
            inLobby={game?.state === 'lobby' || game === null}
            onExit={onExit}
          />
        )}
        <View style={styles.body}>{screen}</View>
      </View>
    </HideChromeContext.Provider>
  );

  const lobby = (
    <LobbyScreen
      game={game}
      code={joined.code}
      isHost={isHost}
      error={error}
      location={location}
      onStarted={applyState}
    />
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
    if (onTeam && game.state === 'round1_active' && stillWorking) {
      return framed(<HuntScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />);
    }
    // The list is finished, or the host called time: head back.
    if (onTeam && (game.state === 'round1_active' || game.state === 'round1_return')) {
      return framed(regrouping);
    }
    if (isHost && REGROUP_STATES.has(game.state)) return framed(regrouping);
    return framed(lobby);
  }

  // --- photo_chase -----------------------------------------------------------

  if (onTeam && game.state === 'round1_active' && stillWorking) {
    return framed(
      <CaptureScreen
        gameId={joined.gameId}
        teamId={joined.teamId!}
        quota={game.config.photosPerRound}
        capture={capture}
        taken={regroup?.me?.done}
      />,
    );
  }
  if (onTeam && game.state === 'round2_active' && stillWorking) {
    return framed(<ChaseScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />);
  }
  /**
   * Quota met, or the host called time: the regroup screen. This is also what
   * removes `CaptureScreen`'s dead end — taking the last photo used to leave you
   * on a disabled "All photos taken" button with nowhere to go, and the check-in
   * button now appears exactly when the server would accept one.
   */
  if (onTeam && REGROUP_STATES.has(game.state)) return framed(regrouping);
  /**
   * A host with no team of their own. Without this they fall through to the lobby
   * and the gate button they are the only person who can press is unreachable —
   * built-but-unrouted, the failure this codebase keeps repeating.
   */
  if (isHost && REGROUP_STATES.has(game.state)) return framed(regrouping);

  return framed(lobby);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
});
