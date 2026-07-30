import { expect, test, type Page } from '@playwright/test';

/**
 * The join-link landing (`/j/<code>`) is where a lobby QR resolves for a phone
 * camera without the app. Like the spectator page it talks to the API at
 * NEXT_PUBLIC_API_URL, intercepted here so the suite needs no backend.
 */
const API = 'http://localhost:3000';

const TEAMS = [
  { teamId: 't1', name: 'Reds', memberCount: 3 },
  { teamId: 't2', name: 'Blues', memberCount: 2 },
];

function gameView(state: string) {
  return {
    id: 'g1',
    code: 'ABC234',
    state,
    config: {
      photosPerRound: 5,
      round1Minutes: 15,
      round2Minutes: 15,
      maxTeams: 2,
      gameType: 'round_robin',
      judgeWeight: 2,
      specialCategories: { presets: [], custom: [] },
      geofencing: false,
      aiJudging: false,
    },
    teams: TEAMS,
    playerCount: 5,
  };
}

async function stubSpectate(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route(`${API}/spectate/*`, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    }),
  );
}

test.describe('join link', () => {
  test('confirms a real game: code, phase, roster, and how to join', async ({ page }) => {
    await stubSpectate(page, { game: gameView('lobby'), scoreboard: null });
    await page.goto('/j/ABC234');

    await expect(page.getByRole('heading', { name: /invited to a game/i })).toBeVisible();
    await expect(page.getByText('ABC234')).toBeVisible();
    await expect(page.getByText(/Waiting for teams/)).toBeVisible();
    await expect(page.getByText('2 teams joined')).toBeVisible();
    await expect(page.getByText(/enter this code to join/i)).toBeVisible();
  });

  test('uppercases a lowercased code in the URL', async ({ page }) => {
    await stubSpectate(page, { game: gameView('lobby'), scoreboard: null });
    await page.goto('/j/abc234');
    await expect(page.getByText('ABC234')).toBeVisible();
  });

  test('offers the big-screen view', async ({ page }) => {
    await stubSpectate(page, { game: gameView('lobby'), scoreboard: null });
    await page.goto('/j/ABC234');
    await expect(page.getByRole('link', { name: /big-screen/i })).toHaveAttribute('href', '/watch/ABC234');
  });

  test('tells the visitor when the code matches no game', async ({ page }) => {
    await stubSpectate(page, { error: 'Game not found.' }, 404);
    await page.goto('/j/ZZZZZZ');
    await expect(page.getByText(/couldn’t find a game/i)).toBeVisible();
    // The code is still shown, so a mistyped share is obvious.
    await expect(page.getByText('ZZZZZZ')).toBeVisible();
  });
});
