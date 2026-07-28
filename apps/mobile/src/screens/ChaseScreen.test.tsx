import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(captureChase).toHaveBeenCalled());
    expect(captureChase.mock.calls[0]![1]).toMatchObject({ teamId: 't1', assignmentId: 'a0' });
  });

  it('advances to the next assignment after a successful chase', async () => {
    listAssignments.mockResolvedValue([assignment(0), assignment(1)]);
    captureChase.mockResolvedValue({ chasePhotoId: 'c1', key: 'k' });
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('Recreate photo #1');
    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('Recreate photo #2')).toBeTruthy();
    expect(screen.getByText('1 / 2 chased')).toBeTruthy();
  });

  it('keeps the same target when the chase fails', async () => {
    listAssignments.mockResolvedValue([assignment(0), assignment(1)]);
    captureChase.mockRejectedValue(new Error('offline'));
    render(<ChaseScreen gameId="g1" teamId="t1" capture={capture} />);

    await screen.findByText('Recreate photo #1');
    fireEvent.click(screen.getByRole('button'));

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
