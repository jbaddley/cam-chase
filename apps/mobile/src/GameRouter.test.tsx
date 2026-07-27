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

const { GameRouter } = await import('./GameRouter.js');

afterEach(cleanup);
beforeEach(() => phase.mockReset());

const capture = () => Promise.resolve({ file: new Blob(['x']), location: { lat: 0, lng: 0 } });

function show(mode: GameMode, state: GameStateView['state'], teamId: string | null = 't1') {
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
    <GameRouter joined={{ gameId: 'g1', code: 'ABC123', teamId, role: 'captain' }} capture={capture} />,
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
      <GameRouter joined={{ gameId: 'g1', code: 'ABC123', teamId: 't1', role: 'captain' }} capture={capture} />,
    );
    shown('LobbyScreen');
  });

  it('treats a game with no mode as a chase, for games that predate modes', () => {
    show(undefined as unknown as GameMode, 'round1_active');
    shown('CaptureScreen');
  });
});
