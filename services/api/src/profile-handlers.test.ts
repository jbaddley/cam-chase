import { describe, expect, it } from 'vitest';
import { InMemoryProfileRepository } from './profile-repo.js';
import { getMyProfile, saveMyProfile } from './profile-handlers.js';

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe('saveMyProfile', () => {
  it('stores the caller’s profile against the token’s user id, defaulting units', async () => {
    const repo = new InMemoryProfileRepository();
    const saved = unwrap(await saveMyProfile(repo, 'user-1', { firstName: 'Ada', lastName: 'Lovelace', displayName: 'Countess' }));
    // Units default to metric when the client sends none.
    expect(saved).toEqual({ userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', displayName: 'Countess', units: 'metric' });
    expect(await repo.get('user-1')).toEqual(saved);
  });

  it('stores the chosen units', async () => {
    const repo = new InMemoryProfileRepository();
    const saved = unwrap(await saveMyProfile(repo, 'user-1', { firstName: 'Ada', lastName: 'L', displayName: 'A', units: 'imperial' }));
    expect(saved.units).toBe('imperial');
  });

  it('trims the fields', async () => {
    const repo = new InMemoryProfileRepository();
    const saved = unwrap(await saveMyProfile(repo, 'user-1', { firstName: '  Ada ', lastName: ' Lovelace ', displayName: ' Countess ' }));
    expect(saved).toEqual({ userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', displayName: 'Countess', units: 'metric' });
  });

  it('rejects a blank field', async () => {
    const repo = new InMemoryProfileRepository();
    const result = await saveMyProfile(repo, 'user-1', { firstName: '   ', lastName: 'L', displayName: 'D' });
    expect(result.ok).toBe(false);
  });

  it('refuses to save with no signed-in user', async () => {
    const repo = new InMemoryProfileRepository();
    const result = await saveMyProfile(repo, '', { firstName: 'A', lastName: 'B', displayName: 'C' });
    expect(result.ok).toBe(false);
  });

  it('writes only the token’s own profile — a body cannot name another user', async () => {
    // The handler takes userId as an argument (the verified token's), and the
    // body is only names. Even a body that smuggles a userId must not land under
    // that id: identity comes from the token, never the payload.
    const repo = new InMemoryProfileRepository();
    await saveMyProfile(repo, 'attacker', {
      firstName: 'Mal',
      lastName: 'Ory',
      displayName: 'Mallory',
      userId: 'victim', // a smuggled identity in the body; must be ignored
    });
    expect(await repo.get('victim')).toBeNull();
    expect((await repo.get('attacker'))?.displayName).toBe('Mallory');
  });
});

describe('getMyProfile', () => {
  it('returns null before a profile is completed', async () => {
    const repo = new InMemoryProfileRepository();
    expect(unwrap(await getMyProfile(repo, 'user-1'))).toBeNull();
  });

  it('returns the caller’s own profile and never another user’s', async () => {
    const repo = new InMemoryProfileRepository();
    await saveMyProfile(repo, 'user-1', { firstName: 'Ada', lastName: 'L', displayName: 'A' });
    await saveMyProfile(repo, 'user-2', { firstName: 'Bea', lastName: 'M', displayName: 'B' });
    expect(unwrap(await getMyProfile(repo, 'user-1'))?.displayName).toBe('A');
    expect(unwrap(await getMyProfile(repo, 'user-2'))?.displayName).toBe('B');
  });

  it('refuses with no signed-in user', async () => {
    const repo = new InMemoryProfileRepository();
    const result = await getMyProfile(repo, '');
    expect(result.ok).toBe(false);
  });
});
