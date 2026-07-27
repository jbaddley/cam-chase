import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferralView } from '@photochase/client';

const getReferral = vi.fn();
const redeemReferral = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    getReferral: () => getReferral(),
    redeemReferral: (code: string) => redeemReferral(code),
  },
}));

const { ReferralScreen } = await import('./ReferralScreen.js');

afterEach(() => {
  cleanup();
  [getReferral, redeemReferral].forEach((m) => m.mockReset());
});

function referral(overrides: Partial<ReferralView> = {}): ReferralView {
  return {
    code: 'ABC123',
    inviteUrl: 'https://photochase.app/i/ABC123',
    creditedReferrals: 0,
    modesEarned: [],
    nextUnlock: { mode: 'scavenger_hunt', referralsAway: 1 },
    flair: null,
    ...overrides,
  };
}

describe('ReferralScreen', () => {
  it('shows the code and its invite link', async () => {
    getReferral.mockResolvedValue(referral());
    render(<ReferralScreen />);

    expect(await screen.findByText('Your code: ABC123')).toBeTruthy();
    expect(screen.getByText('https://photochase.app/i/ABC123')).toBeTruthy();
  });

  it('counts referrals who actually finished a game, not installs', async () => {
    getReferral.mockResolvedValue(referral({ creditedReferrals: 2 }));
    render(<ReferralScreen />);

    expect(await screen.findByText('2 friends have played a full game')).toBeTruthy();
  });

  it('names the next unlock and its cost', async () => {
    getReferral.mockResolvedValue(referral({ creditedReferrals: 2, nextUnlock: { mode: 'color_hunt', referralsAway: 1 } }));
    render(<ReferralScreen />);

    expect(await screen.findByText('1 more to unlock Colour hunt')).toBeTruthy();
  });

  it('says the ladder is topped rather than showing an empty target', async () => {
    getReferral.mockResolvedValue(referral({ creditedReferrals: 9, nextUnlock: null }));
    render(<ReferralScreen />);

    expect(await screen.findByText("You've unlocked every mode.")).toBeTruthy();
  });

  it('lists what has already been earned', async () => {
    getReferral.mockResolvedValue(referral({ creditedReferrals: 3, modesEarned: ['scavenger_hunt', 'color_hunt'] }));
    render(<ReferralScreen />);

    expect(await screen.findByText('Earned: Scavenger hunt, Colour hunt')).toBeTruthy();
  });

  it('shows flair once earned, and nothing before', async () => {
    getReferral.mockResolvedValue(referral({ creditedReferrals: 3, flair: 'connector' }));
    const { unmount } = render(<ReferralScreen />);
    expect(await screen.findByText('Status: Connector')).toBeTruthy();
    unmount();

    getReferral.mockResolvedValue(referral());
    render(<ReferralScreen />);
    await screen.findByText('Your code: ABC123');
    expect(screen.queryByText(/^Status:/)).toBeNull();
  });

  it('always states the perk a subscriber can use', async () => {
    // A paying host has no use for a mode key; guests playing free is the pitch.
    getReferral.mockResolvedValue(referral());
    render(<ReferralScreen />);

    expect(
      await screen.findByText('Anyone you invite plays your games on your plan — they never need to pay.'),
    ).toBeTruthy();
  });

  it('redeems a typed code, upper-cased', async () => {
    getReferral.mockResolvedValue(referral());
    redeemReferral.mockResolvedValue({ attributed: true });
    render(<ReferralScreen />);

    await screen.findByText('Your code: ABC123');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xyz789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }));

    await waitFor(() => expect(redeemReferral).toHaveBeenCalledWith('XYZ789'));
    expect(await screen.findByText('Invite accepted.')).toBeTruthy();
  });

  it('reports the server’s reason when a code does not attribute', async () => {
    getReferral.mockResolvedValue(referral());
    redeemReferral.mockResolvedValue({ attributed: false, reason: 'You already came in on an invite.' });
    render(<ReferralScreen />);

    await screen.findByText('Your code: ABC123');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XYZ789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }));

    expect(await screen.findByText('You already came in on an invite.')).toBeTruthy();
  });

  it('does not call the server for an empty code', async () => {
    getReferral.mockResolvedValue(referral());
    render(<ReferralScreen />);

    await screen.findByText('Your code: ABC123');
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }));

    await waitFor(() => expect(redeemReferral).not.toHaveBeenCalled());
  });

  it('reports a standing that could not be loaded', async () => {
    getReferral.mockRejectedValue(new Error('offline'));
    render(<ReferralScreen />);

    expect(await screen.findByText('Could not load your invite code.')).toBeTruthy();
  });
});
