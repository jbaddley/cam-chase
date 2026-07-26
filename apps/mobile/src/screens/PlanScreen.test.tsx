import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementView } from '@photochase/client';

const getEntitlement = vi.fn();
vi.mock('../api.js', () => ({ client: { getEntitlement: () => getEntitlement() } }));

const { PlanScreen } = await import('./PlanScreen.js');

afterEach(() => {
  cleanup();
  getEntitlement.mockReset();
});

function entitlement(overrides: Partial<EntitlementView> = {}): EntitlementView {
  return {
    tier: 'free',
    gameCredits: 0,
    subscriptionActive: false,
    canStartGame: true,
    limits: { maxTeams: 2 },
    features: { ai_judging: false, up_to_6_teams: false },
    ...overrides,
  } as unknown as EntitlementView;
}

describe('PlanScreen', () => {
  it('shows the tier and the plan’s team cap', async () => {
    getEntitlement.mockResolvedValue(entitlement());
    render(<PlanScreen onBack={vi.fn()} />);

    expect(await screen.findByText(/free/)).toBeTruthy();
    expect(screen.getByText('Up to 2 teams')).toBeTruthy();
  });

  it('shows remaining credits on a game pack', async () => {
    getEntitlement.mockResolvedValue(entitlement({ tier: 'game_pack', gameCredits: 3 }));
    render(<PlanScreen onBack={vi.fn()} />);

    expect(await screen.findByText('3 game credits left')).toBeTruthy();
  });

  it('shows subscription state instead of credits when subscribed', async () => {
    getEntitlement.mockResolvedValue(entitlement({ tier: 'unlimited', subscriptionActive: true, gameCredits: 0 }));
    render(<PlanScreen onBack={vi.fn()} />);

    expect(await screen.findByText('Subscription active')).toBeTruthy();
    expect(screen.queryByText(/game credits left/)).toBeNull();
  });

  it('marks features on and off from the entitlement’s own flags', async () => {
    getEntitlement.mockResolvedValue(
      entitlement({ tier: 'game_pack', features: { ai_judging: true, up_to_6_teams: false } as never }),
    );
    render(<PlanScreen onBack={vi.fn()} />);

    await screen.findByText(/game_pack/);
    const enabled = screen.getByText('AI judging').parentElement!;
    const disabled = screen.getByText('Up to 6 teams').parentElement!;
    expect(enabled.textContent).toContain('✓');
    expect(disabled.textContent).toContain('—');
  });

  it('shows the server’s reason when a game cannot be started', async () => {
    getEntitlement.mockResolvedValue(
      entitlement({ tier: 'game_pack', canStartGame: false, cannotStartReason: 'No game credits left.' }),
    );
    render(<PlanScreen onBack={vi.fn()} />);

    expect(await screen.findByText('No game credits left.')).toBeTruthy();
  });

  it('reports a load failure and still offers a way back', async () => {
    getEntitlement.mockRejectedValue(new Error('offline'));
    render(<PlanScreen onBack={vi.fn()} />);

    expect(await screen.findByText('Could not load your plan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});
