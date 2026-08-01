import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const saveProfile = vi.fn();
const setCurrentProfile = vi.fn();
vi.mock('../api.js', () => ({ client: { saveProfile: (input: unknown) => saveProfile(input) } }));
vi.mock('../profile.js', () => ({
  setCurrentProfile: (p: unknown) => setCurrentProfile(p),
  deviceUnits: () => 'metric',
}));

const { CompleteProfileScreen } = await import('./CompleteProfileScreen.js');

afterEach(() => {
  cleanup();
  [saveProfile, setCurrentProfile].forEach((m) => m.mockReset());
});

function fill() {
  fireEvent.change(screen.getByText('First name').parentElement!.querySelector('input')!, { target: { value: 'Ada' } });
  fireEvent.change(screen.getByText('Last name').parentElement!.querySelector('input')!, { target: { value: 'Lovelace' } });
  fireEvent.change(screen.getByText('Display name').parentElement!.querySelector('input')!, { target: { value: 'Countess' } });
}

describe('CompleteProfileScreen', () => {
  it('names what is missing until every field is filled', () => {
    render(<CompleteProfileScreen onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fill in every field' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fill in every field' }));
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('flags a field once it is left empty', () => {
    render(<CompleteProfileScreen onDone={vi.fn()} />);
    const first = screen.getByText('First name').parentElement!.querySelector('input')!;
    fireEvent.blur(first);
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
  });

  it('saves the trimmed profile and hands it back', async () => {
    const saved = { firstName: 'Ada', lastName: 'Lovelace', displayName: 'Countess' };
    saveProfile.mockResolvedValue(saved);
    const onDone = vi.fn();
    render(<CompleteProfileScreen onDone={onDone} />);

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    // Units are seeded from the device (mocked to metric here).
    expect(saveProfile.mock.calls[0]![0]).toEqual({ ...saved, units: 'metric' });
    expect(setCurrentProfile).toHaveBeenCalledWith(saved);
    expect(onDone).toHaveBeenCalledWith(saved);
  });

  it('shows the failure and stays on the form', async () => {
    saveProfile.mockRejectedValue(new Error('offline'));
    const onDone = vi.fn();
    render(<CompleteProfileScreen onDone={onDone} />);

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save your profile. Check your connection.')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
