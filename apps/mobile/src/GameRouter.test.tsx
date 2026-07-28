import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameStateView } from '@photochase/client';
import type { GameMode } from '@photochase/shared';

/**
 * The router is what makes every mode's screens reachable. Before the modes
 * shipped it dispatched on phase alone, which meant a hunt, a colour hunt and a
 * tag game all showed the chase's screens — the reason these tests exist.
 */

const phase = vi.fn();
vi.mock('./useGamePhase.js', () => ({ useGamePhase: (gameId: string) => phase(gameId) }));

/**
 * The roster decides whether a team is still shooting or heading back, which is
 * now half of what the router dispatches on. Default: still shooting, so the
 * existing expectations about Round 1 and Round 2 screens hold.
 */
const regroup = vi.fn();
vi.mock('./useRegroup.js', () => ({ useRegroup: (gameId: string, active: boolean) => regroup(gameId, active) }));

// Every screen the router can land on, stubbed to render its own name. The
// unit under test is the choice of screen, not what the chosen screen renders.
// The factories are written out rather than generated because `vi.mock` is
// hoisted above anything defined in this file.
vi.mock('./screens/CaptureScreen.js', () => ({ CaptureScreen: () => <span>CaptureScreen</span> }));
vi.mock('./screens/ChaseScreen.js', () => ({ ChaseScreen: () => <span>ChaseScreen</span> }));
vi.mock('./screens/ColorShootScreen.js', () => ({ ColorShootScreen: () => <span>ColorShootScreen</span> }));
vi.mock('./screens/FinalsScreen.js', () => ({ FinalsScreen: () => <span>FinalsScreen</span> }));
vi.mock('./screens/GuessScreen.js', () => ({ GuessScreen: () => <span>GuessScreen</span> }));
vi.mock('./screens/HuntScreen.js', () => ({ HuntScreen: () => <span>HuntScreen</span> }));
vi.mock('./screens/LobbyScreen.js', () => ({ LobbyScreen: () => <span>LobbyScreen</span> }));
vi.mock('./screens/RatingScreen.js', () => ({ RatingScreen: () => <span>RatingScreen</span> }));
vi.mock('./screens/ResultsScreen.js', () => ({ ResultsScreen: () => <span>ResultsScreen</span> }));
vi.mock('./screens/ReturnScreen.js', () => ({ ReturnScreen: () => <span>ReturnScreen</span> }));
vi.mock('./screens/TagScreen.js', () => ({ TagScreen: () => <span>TagScreen</span> }));
// The bar is on every screen; the router's job is which screen, not the bar.
vi.mock('./screens/GameBar.js', () => ({ GameBar: () => <span>GameBar</span> }));

const { GameRouter } = await import('./GameRouter.js');

afterEach(cleanup);
beforeEach(() => {
  phase.mockReset();
  onExit.mockReset();
  regroup.mockReset();
  setStatus('shooting');
});

/** Point the roster at a status for the caller's own team. */
function setStatus(status: 'shooting' | 'heading_back' | 'ready', done = 0) {
  regroup.mockReturnValue({
    regroup: {
      round: 1,
      calledBack: false,
      fenced: true,
      roundStartedAt: 0,
      roundEndsAt: 1,
      teams: [{ teamId: 't1', name: 'Reds', status }],
      readyCount: status === 'ready' ? 1 : 0,
      teamCount: 1,
      allReady: status === 'ready',
      me: { teamId: 't1', status, done, goal: 5 },
    },
    error: null,
    refresh: vi.fn(),
  });
}

const capture = () => Promise.resolve({ file: new Blob(['x']), location: { lat: 0, lng: 0 } });
const location = { current: () => Promise.resolve({ lat: 0, lng: 0 }), watch: () => () => {} };
const onExit = vi.fn();

function show(mode: GameMode, state: GameStateView['state'], teamId: string | null = 't1', role?: string) {
  phase.mockReturnValue({
    game: {
      id: 'g1',
      code: 'ABC123',
      state,
      config: { mode, photosPerRound: 5 } as GameStateView['config'],
      teams: [{ teamId: 't1', name: 'Reds', memberCount: 1 }],
      playerCount: 1,
      hostTier: 'free',
    },
    error: null,
    applyState: vi.fn(),
  });
  render(
    <GameRouter
      joined={{ gameId: 'g1', code: 'ABC123', teamId, role: role ?? 'captain' }}
      capture={capture}
      location={location}
      onExit={onExit}
    />,
  );
}

const shown = (name: string) => expect(screen.getByText(name)).toBeTruthy();

describe('GameRouter — photo chase', () => {
  it('shoots originals in Round 1', () => {
    show('photo_chase', 'round1_active');
    shown('CaptureScreen');
  });

  it('chases in Round 2', () => {
    show('photo_chase', 'round2_active');
    shown('ChaseScreen');
  });

  it('checks in during a return phase', () => {
    show('photo_chase', 'round1_return');
    shown('ReturnScreen');
  });

  /**
   * Finishing the quota used to leave a team on a disabled "All photos taken"
   * button with nowhere to go. The round is still running here — other teams are
   * out shooting — and this team is sent to regroup regardless.
   */
  it('sends a team that has finished its photos to regroup, mid-round', () => {
    setStatus('heading_back', 5);
    show('photo_chase', 'round1_active');
    shown('ReturnScreen');
  });

  it('keeps a team that is still shooting on the capture screen', () => {
    setStatus('shooting', 2);
    show('photo_chase', 'round1_active');
    shown('CaptureScreen');
  });

  it('sends a team that has finished its chases to regroup', () => {
    setStatus('heading_back', 5);
    show('photo_chase', 'round2_active');
    shown('ReturnScreen');
  });

  /**
   * A host who chose to judge or spectate has no team, so every `onTeam` branch
   * skips them and they used to fall through to the lobby — leaving the Start
   * Round 2 button, which only they can press, unreachable. That is the
   * built-but-unrouted failure this codebase keeps repeating.
   */
  it('gives a host with no team the regroup console', () => {
    show('photo_chase', 'round1_return', null, 'host');
    shown('ReturnScreen');
  });

  it('still leaves a teamless non-host in the lobby', () => {
    show('photo_chase', 'round1_return', null, 'judge');
    shown('LobbyScreen');
  });
});

describe('GameRouter — scavenger hunt', () => {
  it('shows the hunt list, not the chase capture screen', () => {
    // The bug this file exists to stop: same phase name, different game.
    show('scavenger_hunt', 'round1_active');
    shown('HuntScreen');
  });

  it('keeps the return check-in, which the hunt reuses', () => {
    show('scavenger_hunt', 'round1_return');
    shown('ReturnScreen');
  });
});

describe('GameRouter — colour hunt', () => {
  it('shows the secret alongside shooting in Round 1', () => {
    show('color_hunt', 'round1_active');
    shown('ColorShootScreen');
  });

  it('opens the guessing window', () => {
    show('color_hunt', 'guessing');
    shown('GuessScreen');
  });

  it('lets a judge into the guessing window too', () => {
    show('color_hunt', 'guessing', null);
    shown('GuessScreen');
  });
});

describe('GameRouter — photo tag', () => {
  it('holds players on the scatter view', () => {
    show('photo_tag', 'scatter');
    shown('TagScreen');
  });

  it('runs live play', () => {
    show('photo_tag', 'tag_active');
    shown('TagScreen');
  });

  it('leaves a judge in the lobby, since they chase nobody', () => {
    show('photo_tag', 'tag_active', null);
    shown('LobbyScreen');
  });
});

describe('GameRouter — shared phases', () => {
  it.each(['photo_chase', 'scavenger_hunt', 'color_hunt', 'photo_tag'] as const)(
    'rates the same way in %s',
    (mode) => {
      show(mode, 'rating');
      shown('RatingScreen');
    },
  );

  it.each(['photo_chase', 'scavenger_hunt', 'color_hunt', 'photo_tag'] as const)(
    'shows results the same way in %s',
    (mode) => {
      show(mode, 'results');
      shown('ResultsScreen');
    },
  );

  it('lets a judge rate, since rating is not gated on a team', () => {
    show('scavenger_hunt', 'rating', null);
    shown('RatingScreen');
  });

  it('falls back to the lobby before the state has loaded', () => {
    phase.mockReturnValue({ game: null, error: null, applyState: vi.fn() });
    render(
      <GameRouter
        joined={{ gameId: 'g1', code: 'ABC123', teamId: 't1', role: 'captain' }}
        capture={capture}
        location={location}
        onExit={onExit}
      />,
    );
    shown('LobbyScreen');
  });

  it('treats a game with no mode as a chase, for games that predate modes', () => {
    show(undefined as unknown as GameMode, 'round1_active');
    shown('CaptureScreen');
  });

  it('sends the player home when the host ends the game', async () => {
    // Archived means somebody ended it. Sitting on a dead game is the trap the
    // exit exists to avoid, so the router leaves without being asked.
    show('photo_chase', 'archived');
    await vi.waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it('stays put while the game is still running', () => {
    show('photo_chase', 'round1_active');
    expect(onExit).not.toHaveBeenCalled();
  });
});
