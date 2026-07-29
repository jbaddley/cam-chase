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

/**
 * Open the view controls. They are collapsed by default — left open they cover
 * the part of the frame you are lining the shot up against — so a test that
 * wants a mode or a level has to reveal them first, exactly as a player does.
 */
const openControls = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /^Original (at \d+%|hidden)$|^Side by side$/ }));
};

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
  /**
   * The controls were a slab covering the top half of the frame — over exactly
   * the part of the scene you line the shot up against, which is the one thing
   * this screen exists to let you see.
   */
  it('keeps the view controls out of the frame until asked for', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByTestId('chase-original');
    // Collapsed: no mode chips, no level chips.
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Overlay' })).toBeNull();
    expect(screen.queryByRole('button', { name: '25%' })).toBeNull();

    // Discoverable: one chip that states where the original stands.
    expect(screen.getByRole('button', { name: 'Original at 40%' })).toBeTruthy();

    await openControls();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '25%' })).toBeTruthy();
  });

  it('folds the controls away again', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await openControls();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('stays open while the level is being tried', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await openControls();
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    // Picking a level is something you do two or three times in a row while
    // watching the overlay settle; closing after each tap would be worse.
    expect(screen.getByRole('button', { name: '60%' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '60%' }));
    expect(screen.getByText('Original at 60%')).toBeTruthy();
  });

  it('says the original is hidden when it is', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await openControls();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The collapsed chip states the setting rather than a verb, so a player who
    // hid it yesterday can tell at a glance why they see no original.
    expect(screen.getByRole('button', { name: 'Original hidden' })).toBeTruthy();
  });

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
    await openControls();
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
    // Collapsed, the chip itself states the level.
    expect(await screen.findByRole('button', { name: 'Original at 40%' })).toBeTruthy();
    await openControls();
    fireEvent.click(screen.getByRole('button', { name: '80%' }));
    expect(screen.getByText('Original at 80%')).toBeTruthy();
  });

  /**
   * One mode, named for the arrangement in use. Splitting is the same idea either
   * way — show me both at once — so the player picks that, not a direction.
   */
  it('names the split for how the phone is held', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    const { unmount } = render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByTestId('chase-original');
    await openControls();
    expect(screen.getByRole('button', { name: 'Top and bottom' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Side by side' })).toBeNull();
    unmount();

    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} landscape />);
    await openControls();
    expect(screen.getByRole('button', { name: 'Side by side' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Top and bottom' })).toBeNull();
  });

  /**
   * The bug this replaces: the original took half the screen while the camera
   * quietly kept all of it, so the half you were matching against was not the
   * shot you were taking. There used to be a string here explaining that away.
   * The camera is clipped to its own square now, so there is nothing to explain.
   */
  it('puts the original beside the camera when split, and over it when overlaid', async () => {
    listAssignments.mockResolvedValue([assignment(0)]);
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} landscape />);

    // Overlay is the default: the original sits on the camera square.
    expect(await screen.findByTestId('chase-original-over')).toBeTruthy();

    await openControls();
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));

    expect(screen.getByTestId('chase-original-beside')).toBeTruthy();
    expect(screen.queryByTestId('chase-original-over')).toBeNull();
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
