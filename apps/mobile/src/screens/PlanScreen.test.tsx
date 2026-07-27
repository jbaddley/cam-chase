import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementView } from '@photochase/client';
import type { PurchaseGateway } from '../purchases.js';

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
    modes: ['photo_chase'],
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

  describe('purchases', () => {
    /** A gateway offering one product, with injectable purchase behaviour. */
    function gateway(overrides: Partial<PurchaseGateway> = {}): PurchaseGateway {
      return {
        listProducts: () =>
          Promise.resolve([{ sku: 'game_pack', priceLabel: '$3.99', subscription: false }]),
        purchase: () => Promise.resolve({ status: 'purchased', sku: 'game_pack' }),
        restore: () => Promise.resolve(),
        ...overrides,
      };
    }

    it('lists the offered products with their store prices', async () => {
      getEntitlement.mockResolvedValue(entitlement());
      render(<PlanScreen onBack={vi.fn()} purchases={gateway()} />);

      expect(await screen.findByText(/Game pack · \$3\.99/)).toBeTruthy();
    });

    it('re-reads the entitlement after a purchase rather than granting locally', async () => {
      // The store notifies the server; the app only re-reads what it owns.
      getEntitlement
        .mockResolvedValueOnce(entitlement({ tier: 'free' }))
        .mockResolvedValueOnce(entitlement({ tier: 'game_pack', gameCredits: 2 }));
      render(<PlanScreen onBack={vi.fn()} purchases={gateway()} />);

      await screen.findByText(/free/);
      fireEvent.click(screen.getByRole('button', { name: 'Buy' }));

      expect(await screen.findByText('2 game credits left')).toBeTruthy();
      expect(getEntitlement).toHaveBeenCalledTimes(2);
    });

    it('does not re-read or complain when the user cancels', async () => {
      // A second read would report game_pack; cancelling must not reach it.
      getEntitlement
        .mockResolvedValueOnce(entitlement({ tier: 'free' }))
        .mockResolvedValue(entitlement({ tier: 'game_pack', gameCredits: 2 }));
      const purchases = gateway({ purchase: () => Promise.resolve({ status: 'cancelled' }) });
      render(<PlanScreen onBack={vi.fn()} purchases={purchases} />);

      await screen.findByText(/free/);
      fireEvent.click(screen.getByRole('button', { name: 'Buy' }));

      // Wait for the purchase to finish (the button leaves its busy label),
      // so a stray refresh would have landed by the time we assert.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Buy' })).toBeTruthy());
      expect(screen.getByText(/free/)).toBeTruthy();
      expect(screen.queryByText('2 game credits left')).toBeNull();
      expect(getEntitlement).toHaveBeenCalledTimes(1);
    });

    it('explains a pending purchase without granting anything', async () => {
      getEntitlement.mockResolvedValue(entitlement());
      const purchases = gateway({ purchase: () => Promise.resolve({ status: 'pending' }) });
      render(<PlanScreen onBack={vi.fn()} purchases={purchases} />);

      await screen.findByText(/free/);
      fireEvent.click(screen.getByRole('button', { name: 'Buy' }));

      expect(await screen.findByText('Purchase is pending approval.')).toBeTruthy();
      expect(getEntitlement).toHaveBeenCalledTimes(1);
    });

    it('reports a failed purchase', async () => {
      getEntitlement.mockResolvedValue(entitlement());
      const purchases = gateway({ purchase: () => Promise.reject(new Error('store down')) });
      render(<PlanScreen onBack={vi.fn()} purchases={purchases} />);

      await screen.findByText(/free/);
      fireEvent.click(screen.getByRole('button', { name: 'Buy' }));

      expect(await screen.findByText('Purchase could not be completed.')).toBeTruthy();
    });

    it('restores purchases and refreshes the entitlement', async () => {
      getEntitlement.mockResolvedValue(entitlement());
      const restore = vi.fn().mockResolvedValue(undefined);
      render(<PlanScreen onBack={vi.fn()} purchases={gateway({ restore })} />);

      await screen.findByText(/free/);
      fireEvent.click(screen.getByRole('button', { name: 'Restore purchases' }));

      expect(await screen.findByText('Purchases restored.')).toBeTruthy();
      expect(restore).toHaveBeenCalled();
      expect(getEntitlement).toHaveBeenCalledTimes(2);
    });

    it('still shows the plan when no store gateway is configured', async () => {
      getEntitlement.mockResolvedValue(entitlement());
      render(<PlanScreen onBack={vi.fn()} />);

      // The plan must render even with no products to sell.
      expect(await screen.findByText(/free/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull();
    });
  });
});
