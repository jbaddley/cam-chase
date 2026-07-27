import type { GameMode } from '@photochase/shared';
import { CaptureScreen, type CaptureSource } from './screens/CaptureScreen.js';
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
export function GameRouter({ joined, capture }: { joined: JoinedGame; capture: CaptureSource }) {
  const { game, error, applyState } = useGamePhase(joined.gameId);
  const onTeam = joined.teamId !== null;
  const isHost = joined.role === 'host';
  const mode: GameMode = game?.config.mode ?? 'photo_chase';

  const lobby = (
    <LobbyScreen game={game} code={joined.code} isHost={isHost} error={error} onStarted={applyState} />
  );

  if (!game) return lobby;

  // --- shared tail: every mode ends the same way -----------------------------

  if (game.state === 'rating') {
    // Judges and spectators rate too, so this is not gated on team membership.
    return <RatingScreen gameId={joined.gameId} />;
  }
  if (game.state === 'finals_voting') {
    return <FinalsScreen gameId={joined.gameId} myTeamId={joined.teamId} />;
  }
  if (game.state === 'results' || game.state === 'archived') {
    return <ResultsScreen gameId={joined.gameId} teams={game.teams} mode={mode} />;
  }

  // --- per-mode play ---------------------------------------------------------

  if (mode === 'photo_tag') {
    if (!onTeam) return lobby; // judges and spectators do not chase anyone
    if (game.state === 'scatter' || game.state === 'tag_active') {
      return (
        <TagScreen
          gameId={joined.gameId}
          teams={game.teams}
          scattering={game.state === 'scatter'}
          capture={capture}
        />
      );
    }
    return lobby;
  }

  if (mode === 'color_hunt') {
    if (game.state === 'guessing') return <GuessScreen gameId={joined.gameId} />;
    if (onTeam && game.state === 'round1_active') {
      return (
        <ColorShootScreen
          gameId={joined.gameId}
          teamId={joined.teamId!}
          quota={game.config.photosPerRound}
          capture={capture}
        />
      );
    }
    return lobby;
  }

  if (mode === 'scavenger_hunt') {
    if (onTeam && game.state === 'round1_active') {
      return <HuntScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />;
    }
    if (onTeam && game.state === 'round1_return') {
      return <ReturnScreen gameId={joined.gameId} round={1} capture={capture} />;
    }
    return lobby;
  }

  // --- photo_chase -----------------------------------------------------------

  if (onTeam && game.state === 'round1_active') {
    return (
      <CaptureScreen
        gameId={joined.gameId}
        teamId={joined.teamId!}
        quota={game.config.photosPerRound}
        capture={capture}
      />
    );
  }
  if (onTeam && game.state === 'round2_active') {
    return <ChaseScreen gameId={joined.gameId} teamId={joined.teamId!} capture={capture} />;
  }
  if (onTeam && (game.state === 'round1_return' || game.state === 'round2_return')) {
    return (
      <ReturnScreen gameId={joined.gameId} round={game.state === 'round1_return' ? 1 : 2} capture={capture} />
    );
  }

  return lobby;
}
