import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScanContext, ViewfinderContext, useBarcodeScan, useViewfinder } from './viewfinder.js';

/**
 * The camera preview is owned above the screens, so what these tests pin is the
 * handshake: a shooting screen asks for the preview while it is mounted and
 * gives it back when it is not. Getting the release wrong leaves the camera
 * running behind the results screen.
 */

afterEach(cleanup);

function Shooter({ active }: { active?: boolean }) {
  useViewfinder(active);
  return <span>shooting</span>;
}

describe('useViewfinder', () => {
  it('turns the preview on while mounted and off on unmount', () => {
    const setActive = vi.fn();
    const view = render(
      <ViewfinderContext.Provider value={setActive}>
        <Shooter />
      </ViewfinderContext.Provider>,
    );
    expect(setActive.mock.calls).toEqual([[true]]);

    view.unmount();
    expect(setActive.mock.calls).toEqual([[true], [false]]);
  });

  it('stays off when the screen says it is not shooting yet', () => {
    const setActive = vi.fn();
    render(
      <ViewfinderContext.Provider value={setActive}>
        <Shooter active={false} />
      </ViewfinderContext.Provider>,
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  it('does nothing without a camera above it, so tests and stubs render', () => {
    // The default is a no-op rather than a throw: a screen is perfectly usable
    // with a placeholder capture source and no camera in the tree.
    expect(() => render(<Shooter />)).not.toThrow();
  });
});

function ScanReader({ onScan }: { onScan: (data: string) => void }) {
  useBarcodeScan(onScan);
  return <span>reading</span>;
}

describe('useBarcodeScan', () => {
  it('subscribes and asks for the preview while mounted, and releases both on unmount', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const setActive = vi.fn();

    const view = render(
      <ViewfinderContext.Provider value={setActive}>
        <BarcodeScanContext.Provider value={subscribe}>
          <ScanReader onScan={() => {}} />
        </BarcodeScanContext.Provider>
      </ViewfinderContext.Provider>,
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith(true);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenLastCalledWith(false);
  });

  it('renders with no camera above it, so a scan screen is testable in isolation', () => {
    expect(() => render(<ScanReader onScan={() => {}} />)).not.toThrow();
  });
});
