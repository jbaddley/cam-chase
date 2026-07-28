import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentView } from '@photochase/client';

const listAssignments = vi.fn();
const captureChase = vi.fn();
const requestDownload = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    listAssignments: (id: string) => listAssignments(id),
    captureChase: (id: string, input: unknown) => captureChase(id, input),
    requestDownload: (id: string, photoId: string, opts?: unknown) => requestDownload(id, photoId, opts),
  },
}));

const { ChaseScreen } = await import('./ChaseScreen.js');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  listAssignments.mockReset();
  captureChase.mockReset();
  requestDownload.mockReset();
  // Every test shows an original, so the default is a URL rather than a
  // rejection — a test about the image says so by overriding this.
  requestDownload.mockResolvedValue({ url: 'https://signed.example/photo.jpg' });
});

// The screen fetches a signed URL on mount, so the default must be in place
// before the first render in every test, not only after the first afterEach.
requestDownload.mockResolvedValue({ url: 'https://signed.example/photo.jpg' });

const capture = () => Promise.resolve({ file: new Blob(['x']), location: { lat: 1, lng: 2 } });

/**
 * The shutter, by name. The view controls are Pressables too, so a bare
 * `getByRole('button')` is ambiguous now that the screen offers them.
 */
const shutter = () => screen.getByRole('button', { name: 'Take chase photo' });

function assignment(order: number, chased = false): AssignmentView {
  return {
    assignmentId: `a${order}`,
    order,
    originalPhotoId: `p${order}`,
    originalPhotoKey: `key${order}`,
    chasePhotoId: chased ? `c${order}` : null,
  };
}

describe('ChaseScreen', () => {
  it('shows progress over the loaded queue', async () => {
    listAssignments.mockResolvedValue([assignment(0), assignment(1, true)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('1 / 2 chased')).toBeTruthy();
  });

  // Recreating a photo is the screen that most needs the preview — you are
  // matching a frame — so it must not be built on the opaque screen.
  it('is built on the viewfinder frame, not an opaque screen', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByTestId('viewfinder-frame')).toBeTruthy();
  });

  it('targets the first unchased assignment, not simply the first', async () => {
    listAssignments.mockResolvedValue([assignment(0, true), assignment(1)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    // Assignment 0 is already done, so the target is #2 (order 1).
    expect(await screen.findByText('Recreate photo #2')).toBeTruthy();
  });

  it('submits the chase against the current assignment', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    captureChase.mockResolvedValue({ chasePhotoId: 'c1', key: 'k' });
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('0 / 1 chased');
    fireEvent.click(shutter());

    await waitFor(() => expect(captureChase).toHaveBeenCalled());
    expect(captureChase.mock.calls[0]![1]).toMatchObject({ teamId: 't1', assignmentId: 'a0' });
  });

  it('advances to the next assignment after a successful chase', async () => {
    listAssignments.mockResolvedValue([assignment(0), assignment(1)]);
    captureChase.mockResolvedValue({ chasePhotoId: 'c1', key: 'k' });
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('Recreate photo #1');
    fireEvent.click(shutter());

    expect(await screen.findByText('Recreate photo #2')).toBeTruthy();
    expect(screen.getByText('1 / 2 chased')).toBeTruthy();
  });

  it('keeps the same target when the chase fails', async () => {
    listAssignments.mockResolvedValue([assignment(0), assignment(1)]);
    captureChase.mockRejectedValue(new Error('offline'));
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('Recreate photo #1');
    fireEvent.click(shutter());

    expect(await screen.findByText('Could not save that chase. Try again.')).toBeTruthy();
    expect(screen.getByText('Recreate photo #1')).toBeTruthy();
  });

  it('reports completion when every assignment is chased', async () => {
    listAssignments.mockResolvedValue([assignment(0, true)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('All chases submitted!')).toBeTruthy();
  });

  it('reports a queue that could not be loaded', async () => {
    listAssignments.mockRejectedValue(new Error('offline'));
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('Could not load your assignments.')).toBeTruthy();
  });
});

/**
 * These are structure tests. The harness drops styles, so none of them can tell
 * you the original is *ghosted* over the preview at 40% — only that it is on
 * screen, which arrangement was chosen, and what the screen says the level is.
 * How it actually looks was checked on a device, and has to be.
 */
describe('ChaseScreen — seeing the original', () => {
  it('shows the assigned original, signed as a thumbnail', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    const img = await screen.findByTestId('chase-original');
    expect(img.getAttribute('src')).toBe('https://signed.example/photo.jpg');
    // The original may be 10 MB; 1024px is plenty to line a shot up against.
    expect(requestDownload).toHaveBeenCalledWith('g1', 'p0', { variant: 'thumb' });
  });

  it('hides the original on request so the frame is clear for the shot', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByTestId('chase-original');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByTestId('chase-original')).toBeNull();
    // Hiding the original must not take the shutter with it.
    expect(shutter()).toBeTruthy();
  });

  it('states the onion-skin level and changes it', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    // The level is words because an overlay at 40% and one at 80% are the same
    // DOM here — this is the only assertable form, and the readable one.
    expect(await screen.findByText('Original at 40%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '80%' }));
    expect(screen.getByText('Original at 80%')).toBeTruthy();
  });

  it('offers side by side only when the phone is turned', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    const { unmount } = render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    // Half a portrait screen is not a useful comparison, so it is not offered.
    await screen.findByTestId('chase-original');
    expect(screen.queryByRole('button', { name: 'Side by side' })).toBeNull();
    unmount();

    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} landscape />);
    expect(await screen.findByRole('button', { name: 'Side by side' })).toBeTruthy();
  });

  it('says the photo is still full-frame when side by side', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} landscape />);

    fireEvent.click(await screen.findByRole('button', { name: 'Side by side' }));
    // The split is a place to look, not a viewport. Every player assumes
    // otherwise once, and only the wording can correct it.
    expect(screen.getByText('Your photo still captures the whole frame.')).toBeTruthy();
  });

  it('says so when the original cannot be signed', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    requestDownload.mockRejectedValue(new Error('gone'));
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    expect(await screen.findByText('Could not load the original.')).toBeTruthy();
    // Losing the reference must not cost you the round.
    expect(shutter()).toBeTruthy();
  });

  it('re-signs the original before the URL expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await vi.waitFor(() => expect(requestDownload).toHaveBeenCalledTimes(1));
    // Signed URLs last five minutes and a chase takes longer, so the screen
    // re-mints at four rather than showing a broken image mid-round.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(241_000);
    });
    expect(requestDownload).toHaveBeenCalledTimes(2);
  });
});
