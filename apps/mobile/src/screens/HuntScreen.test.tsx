import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HuntItemView, HuntView } from '@photochase/client';

const listHuntItems = vi.fn();
const capturePhoto = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    listHuntItems: (id: string) => listHuntItems(id),
    capturePhoto: (id: string, input: unknown) => capturePhoto(id, input),
  },
}));

const { HuntScreen } = await import('./HuntScreen.js');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  [listHuntItems, capturePhoto].forEach((m) => m.mockReset());
});

const LOCATION = { lat: 40, lng: -74 };
const capture = () => Promise.resolve({ file: new Blob(['x']), location: LOCATION });

function item(overrides: Partial<HuntItemView> = {}): HuntItemView {
  return { itemId: 'leaf', label: 'A leaf', rarity: 'common', wildcard: false, claimedPhotoId: null, ...overrides };
}

const hunt = (overrides: Partial<HuntView> = {}): HuntView => ({
  items: [item()],
  wildcardRevealAt: null,
  ...overrides,
});

const itemButton = (label: string) => screen.getByText(label).closest('button')!;

describe('HuntScreen', () => {
  it('lists the items with the team’s progress', async () => {
    listHuntItems.mockResolvedValue(
      hunt({ items: [item(), item({ itemId: 'bird', label: 'A bird', claimedPhotoId: 'p9' })] }),
    );
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('1 / 2 found')).toBeTruthy();
    expect(screen.getByText('Found')).toBeTruthy();
  });

  it('states the pointing rule, which only judging can enforce', async () => {
    listHuntItems.mockResolvedValue(hunt());
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(
      await screen.findByText('Someone from your team has to be in the shot, pointing at it.'),
    ).toBeTruthy();
  });

  it('marks rarity so a team can choose what to chase', async () => {
    listHuntItems.mockResolvedValue(hunt({ items: [item({ rarity: 'rare' })] }));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('Rare')).toBeTruthy();
  });

  it('attaches the claimed item to the captured photo', async () => {
    listHuntItems.mockResolvedValue(hunt());
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('0 / 1 found');
    fireEvent.click(itemButton('A leaf'));

    await waitFor(() => expect(capturePhoto).toHaveBeenCalled());
    expect(capturePhoto.mock.calls[0]![1]).toMatchObject({ teamId: 't1', itemId: 'leaf', location: LOCATION });
  });

  it('refreshes the list after a successful claim', async () => {
    listHuntItems
      .mockResolvedValueOnce(hunt())
      .mockResolvedValueOnce(hunt({ items: [item({ claimedPhotoId: 'p1' })] }));
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('0 / 1 found');
    fireEvent.click(itemButton('A leaf'));

    expect(await screen.findByText('1 / 1 found')).toBeTruthy();
  });

  it('does not mark an item found when the upload fails', async () => {
    listHuntItems.mockResolvedValue(hunt());
    capturePhoto.mockRejectedValue(new Error('offline'));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('0 / 1 found');
    fireEvent.click(itemButton('A leaf'));

    expect(await screen.findByText('Could not save that photo. Try again.')).toBeTruthy();
    expect(screen.getByText('0 / 1 found')).toBeTruthy();
  });

  it('ignores a tap on an item already claimed', async () => {
    listHuntItems.mockResolvedValue(hunt({ items: [item({ claimedPhotoId: 'p1' })] }));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('1 / 1 found');
    fireEvent.click(itemButton('A leaf'));

    await waitFor(() => expect(capturePhoto).not.toHaveBeenCalled());
  });

  it('ignores a second tap while one capture is in flight', async () => {
    listHuntItems.mockResolvedValue(hunt({ items: [item(), item({ itemId: 'bird', label: 'A bird' })] }));
    capturePhoto.mockImplementation(() => new Promise(() => {}));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('0 / 2 found');
    fireEvent.click(itemButton('A leaf'));
    await screen.findByText('Saving…');
    fireEvent.click(itemButton('A bird'));

    expect(capturePhoto).toHaveBeenCalledTimes(1);
  });

  it('reports a list that could not be loaded', async () => {
    listHuntItems.mockRejectedValue(new Error('offline'));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('Could not load the hunt list.')).toBeTruthy();
  });
});

describe('HuntScreen — wildcard', () => {
  it('teases a wildcard that has not dropped yet, without naming it', async () => {
    listHuntItems.mockResolvedValue(hunt({ wildcardRevealAt: 10_000 }));
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} now={() => 0} />);

    expect(await screen.findByText('A wildcard item drops mid-round…')).toBeTruthy();
    expect(screen.queryByText('Wildcard — double points')).toBeNull();
  });

  it('re-fetches at the reveal time and shows the wildcard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const revealed = hunt({
      wildcardRevealAt: 10_000,
      items: [item(), item({ itemId: 'wc', label: 'A statue', rarity: 'rare', wildcard: true })],
    });
    listHuntItems.mockResolvedValueOnce(hunt({ wildcardRevealAt: 10_000 })).mockResolvedValue(revealed);
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} now={() => 0} />);

    await screen.findByText('A wildcard item drops mid-round…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(await screen.findByText('Wildcard — double points')).toBeTruthy();
    expect(screen.queryByText('A wildcard item drops mid-round…')).toBeNull();
  });

  it('does not keep re-fetching once the wildcard is on the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listHuntItems.mockResolvedValue(
      hunt({ wildcardRevealAt: 10_000, items: [item({ itemId: 'wc', label: 'A statue', wildcard: true })] }),
    );
    render(<HuntScreen gameId="g1" teamId="t1" capture={capture} now={() => 0} />);

    await screen.findByText('Wildcard — double points');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(listHuntItems).toHaveBeenCalledTimes(1);
  });
});
