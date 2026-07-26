import { expect, test, type Page } from '@playwright/test';

/**
 * The spectator page talks to the API at NEXT_PUBLIC_API_URL, which defaults to
 * localhost:3000 in the build under test. Every call is intercepted, so the
 * suite needs no backend.
 */
const API = 'http://localhost:3000';

const TEAMS = [
  { teamId: 't1', name: 'Reds', memberCount: 3 },
  { teamId: 't2', name: 'Blues', memberCount: 2 },
];

function gameView(state: string) {
  return {
    id: 'g1',
    code: 'ABC123',
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

/** Serve a canned spectator payload for any code. */
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

test.describe('watch entry', () => {
  test('keeps the button disabled until the code is complete', async ({ page }) => {
    await page.goto('/watch');
    const button = page.getByRole('button', { name: /big-screen/i });
    await expect(button).toBeDisabled();

    await page.getByRole('textbox').fill('ABC12');
    await expect(button).toBeDisabled();

    await page.getByRole('textbox').fill('ABC123');
    await expect(button).toBeEnabled();
  });

  test('uppercases the typed code and opens the big-screen view', async ({ page }) => {
    await stubSpectate(page, { game: gameView('lobby'), scoreboard: null });
    await page.goto('/watch');

    await page.getByRole('textbox').fill('abc123');
    await expect(page.getByRole('textbox')).toHaveValue('ABC123');

    await page.getByRole('button', { name: /big-screen/i }).click();
    await expect(page).toHaveURL(/\/watch\/ABC123$/);
  });
});

test.describe('big screen', () => {
  test('shows the code, phase and roster while the game is in play', async ({ page }) => {
    await stubSpectate(page, { game: gameView('round1_active'), scoreboard: null });
    await page.goto('/watch/ABC123');

    await expect(page.getByRole('heading', { name: 'ABC123' })).toBeVisible();
    await expect(page.getByText(/Round 1 — teams are out shooting/)).toBeVisible();
    await expect(page.getByText('Reds')).toBeVisible();
    await expect(page.getByText('3 players')).toBeVisible();
    await expect(page.getByText('2 players')).toBeVisible();
  });

  test('ranks the final standings once the game is over', async ({ page }) => {
    await stubSpectate(page, {
      game: gameView('results'),
      scoreboard: [
        { teamId: 't1', location: 100, pose: 10, angle: 10, timeBonus: 0, bestMatchBonus: 0, specialBonus: 0, foulPenalty: 0, total: 120 },
        { teamId: 't2', location: 300, pose: 20, angle: 20, timeBonus: 0, bestMatchBonus: 0, specialBonus: 0, foulPenalty: 0, total: 360 },
      ],
    });
    await page.goto('/watch/ABC123');

    await expect(page.getByText('Final results')).toBeVisible();
    // Blues scored higher, so they lead despite being second in the payload.
    const rows = page.locator('ol li');
    await expect(rows.first()).toContainText('Blues');
    await expect(rows.first()).toContainText('360');
    await expect(rows.nth(1)).toContainText('Reds');
  });

  test('lowercases in the URL still resolve', async ({ page }) => {
    await stubSpectate(page, { game: gameView('lobby'), scoreboard: null });
    await page.goto('/watch/abc123');
    await expect(page.getByRole('heading', { name: 'ABC123' })).toBeVisible();
  });

  test('surfaces an error for an unknown code', async ({ page }) => {
    await stubSpectate(page, { error: 'Game not found.' }, 400);
    await page.goto('/watch/ZZZZZZ');

    await expect(page.getByText(/Cannot reach that game/)).toBeVisible();
  });
});
