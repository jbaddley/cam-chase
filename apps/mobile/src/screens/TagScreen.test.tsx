import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatchClaimView, TagBriefView } from '@photochase/client';

const getTagBrief = vi.fn();
const listCatchClaims = vi.fn();
const capturePhoto = vi.fn();
const reportTagPing = vi.fn();
const claimCatch = vi.fn();
const answerCatchClaim = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    getTagBrief: (id: string) => getTagBrief(id),
    listCatchClaims: (id: string) => listCatchClaims(id),
    capturePhoto: (id: string, input: unknown) => capturePhoto(id, input),
    reportTagPing: (id: string, location: unknown) => reportTagPing(id, location),
    claimCatch: (id: string, input: unknown) => claimCatch(id, input),
    answerCatchClaim: (id: string, catchId: string, confirm: boolean) => answerCatchClaim(id, catchId, confirm),
  },
}));

const { TagScreen } = await import('./TagScreen.js');

afterEach(() => {
  cleanup();
  [getTagBrief, listCatchClaims, capturePhoto, reportTagPing, claimCatch, answerCatchClaim].forEach((m) =>
    m.mockReset(),
  );
});

const TEAMS = [
  { teamId: 't1', name: 'Ada', memberCount: 1 },
  { teamId: 't2', name: 'Blake', memberCount: 1 },
  { teamId: 't3', name: 'Cass', memberCount: 1 },
];

const LOCATION = { lat: 40, lng: -74 };
const capture = () => Promise.resolve({ file: new Blob(['x']), location: LOCATION });

function brief(overrides: Partial<TagBriefView> = {}): TagBriefView {
  return {
    teamId: 't1',
    subMode: 'pure_finder',
    role: null,
    targetTeamId: null,
    targetTeamName: null,
    hunterNearby: false,
    ...overrides,
  };
}

const claim = (overrides: Partial<CatchClaimView> = {}): CatchClaimView => ({
  catchId: 'c1',
  hunterTeamName: 'Blake',
  photoKey: 'k1',
  claimedAt: 1000,
  status: 'pending',
  ...overrides,
});

const render_ = (props: Partial<Parameters<typeof TagScreen>[0]> = {}) =>
  render(<TagScreen gameId="g1" teams={TEAMS} capture={capture} {...props} />);

describe('TagScreen — scatter', () => {
  it('tells players to disperse and reveals nothing yet', () => {
    getTagBrief.mockResolvedValue(brief({ role: 'hunter' }));
    listCatchClaims.mockResolvedValue([]);
    render_({ scattering: true });

    expect(screen.getByText('Scatter and hide. Roles are revealed when the timer ends.')).toBeTruthy();
    expect(screen.queryByText('You are the hunter.')).toBeNull();
  });
});

describe('TagScreen — brief', () => {
  it('shows your own role once the round is live', async () => {
    getTagBrief.mockResolvedValue(brief({ role: 'hider' }));
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('You are the hider.')).toBeTruthy();
  });

  it('names your prey and lists only them', async () => {
    getTagBrief.mockResolvedValue(brief({ subMode: 'dual', targetTeamId: 't2', targetTeamName: 'Blake' }));
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('Your target: Blake')).toBeTruthy();
    // Dual is your own chase, so the other players are not offered.
    expect(screen.queryByText('Cass')).toBeNull();
  });

  it('offers everyone else when there is no assigned prey', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('Everyone is fair game.')).toBeTruthy();
    expect(screen.getByText('Blake')).toBeTruthy();
    expect(screen.getByText('Cass')).toBeTruthy();
    // Never yourself.
    expect(screen.queryByText('Ada')).toBeNull();
  });

  it('warns that a hunter is near without naming them', async () => {
    getTagBrief.mockResolvedValue(brief({ hunterNearby: true }));
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('A hunter is nearby.')).toBeTruthy();
  });

  it('says nothing when no hunter is close', async () => {
    getTagBrief.mockResolvedValue(brief({ hunterNearby: false }));
    listCatchClaims.mockResolvedValue([]);
    render_();

    await screen.findByText('Everyone is fair game.');
    expect(screen.queryByText('A hunter is nearby.')).toBeNull();
  });
});

describe('TagScreen — claiming a catch', () => {
  it('shoots, pings, and claims against the chosen player', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([]);
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    reportTagPing.mockResolvedValue({ at: 1 });
    claimCatch.mockResolvedValue({ catchId: 'c9', status: 'pending' });
    render_();

    await screen.findByText('Blake');
    fireEvent.click(screen.getByText('Blake').parentElement!.querySelector('button')!);

    await waitFor(() => expect(claimCatch).toHaveBeenCalled());
    expect(claimCatch.mock.calls[0]![1]).toEqual({ targetTeamId: 't2', photoId: 'p1' });
    expect(reportTagPing).toHaveBeenCalledWith('g1', LOCATION);
  });

  it('says the claim is only pending, not a score', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([]);
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    reportTagPing.mockResolvedValue({ at: 1 });
    claimCatch.mockResolvedValue({ catchId: 'c9', status: 'pending' });
    render_();

    await screen.findByText('Blake');
    fireEvent.click(screen.getByText('Blake').parentElement!.querySelector('button')!);

    expect(await screen.findByText('Claim sent — waiting for them to confirm.')).toBeTruthy();
  });

  it('reports a claim the server refused', async () => {
    const { ApiError } = await import('@photochase/client');
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([]);
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    reportTagPing.mockResolvedValue({ at: 1 });
    claimCatch.mockRejectedValue(new ApiError(400, 'The round is not running.'));
    render_();

    await screen.findByText('Blake');
    fireEvent.click(screen.getByText('Blake').parentElement!.querySelector('button')!);

    expect(await screen.findByText('The round is not running.')).toBeTruthy();
  });
});

describe('TagScreen — answering a claim', () => {
  it('shows a claim made against you', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([claim()]);
    render_();

    expect(await screen.findByText('Blake says they caught you')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  it('confirms a claim', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([claim()]);
    answerCatchClaim.mockResolvedValue({ status: 'confirmed' });
    render_();

    await screen.findByText('Blake says they caught you');
    fireEvent.click(screen.getByRole('button', { name: 'They did' }));

    await waitFor(() => expect(answerCatchClaim).toHaveBeenCalledWith('g1', 'c1', true));
  });

  it('disputes a claim', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([claim()]);
    answerCatchClaim.mockResolvedValue({ status: 'disputed' });
    render_();

    await screen.findByText('Blake says they caught you');
    fireEvent.click(screen.getByRole('button', { name: 'They did not' }));

    await waitFor(() => expect(answerCatchClaim).toHaveBeenCalledWith('g1', 'c1', false));
  });

  it('offers no answer on a claim already settled', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([claim({ status: 'confirmed' })]);
    render_();

    await screen.findByText('Confirmed');
    expect(screen.queryByRole('button', { name: 'They did' })).toBeNull();
  });

  it('says a dispute is now the host’s call', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([claim({ status: 'disputed' })]);
    render_();

    expect(await screen.findByText('Disputed — the host decides')).toBeTruthy();
  });

  it('says so when nobody has claimed anything', async () => {
    getTagBrief.mockResolvedValue(brief());
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('Nobody has claimed to catch you.')).toBeTruthy();
  });

  it('reports a round that could not be loaded', async () => {
    getTagBrief.mockRejectedValue(new Error('offline'));
    listCatchClaims.mockResolvedValue([]);
    render_();

    expect(await screen.findByText('Could not load the round.')).toBeTruthy();
  });
});
