import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const saveProfile = vi.fn();
const setCurrentProfile = vi.fn();
const currentProfile = vi.fn();
vi.mock('../api.js', () => ({ client: { saveProfile: (input: unknown) => saveProfile(input) } }));
vi.mock('../profile.js', () => ({
  currentProfile: () => currentProfile(),
  setCurrentProfile: (p: unknown) => setCurrentProfile(p),
}));

const { ProfileScreen } = await import('./ProfileScreen.js');

afterEach(() => {
  cleanup();
  [saveProfile, setCurrentProfile, currentProfile].forEach((m) => m.mockReset());
});

const PROFILE = { firstName: 'Ada', lastName: 'Lovelace', displayName: 'Countess', units: 'metric' as const };

describe('ProfileScreen', () => {
  it('shows the account name and the current display name', () => {
    currentProfile.mockReturnValue(PROFILE);
    render(<ProfileScreen onBack={vi.fn()} />);

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect((screen.getByText('Display name').parentElement!.querySelector('input') as HTMLInputElement).value).toBe('Countess');
  });

  it('saves a new display name, re-sending first and last unchanged', async () => {
    currentProfile.mockReturnValue(PROFILE);
    const next = { ...PROFILE, displayName: 'Ada L.' };
    saveProfile.mockResolvedValue(next);
    const onBack = vi.fn();
    render(<ProfileScreen onBack={onBack} />);

    fireEvent.change(screen.getByText('Display name').parentElement!.querySelector('input')!, { target: { value: 'Ada L.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    expect(saveProfile.mock.calls[0]![0]).toEqual({ firstName: 'Ada', lastName: 'Lovelace', displayName: 'Ada L.', units: 'metric' });
    expect(setCurrentProfile).toHaveBeenCalledWith(next);
    expect(onBack).toHaveBeenCalled();
  });

  it('changes the distance units and saves them', async () => {
    currentProfile.mockReturnValue(PROFILE); // metric
    saveProfile.mockResolvedValue({ ...PROFILE, units: 'imperial' });
    render(<ProfileScreen onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Imperial (ft, mi)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    expect(saveProfile.mock.calls[0]![0]).toMatchObject({ units: 'imperial' });
  });

  it('blocks an empty display name and flags the field', () => {
    currentProfile.mockReturnValue(PROFILE);
    render(<ProfileScreen onBack={vi.fn()} />);

    fireEvent.change(screen.getByText('Display name').parentElement!.querySelector('input')!, { target: { value: '  ' } });
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill in every field' })).toBeTruthy();
  });
});
