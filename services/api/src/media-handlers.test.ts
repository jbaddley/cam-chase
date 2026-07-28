import { DEFAULT_CONFIG, type Game, type Photo } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeS3Client, S3MediaService } from './media.js';
import { requestPhotoDownload, requestPhotoUpload } from './media-handlers.js';
import { InMemoryGameRepository } from './repository.js';

const media = new S3MediaService(
  makeS3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' } }),
  'photochase-photos-dev',
);

function photo(id: string, teamId: string): Photo {
  return {
    id, gameId: 'g1', teamId, shooterUserId: 'uA', order: 0,
    location: { lat: 0, lng: 0 }, capturedAt: 0, s3Key: `games/g1/${teamId}/${id}.jpg`, fouls: [],
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1', hostUserId: 'host', code: 'ABC123', tier: 'game_pack', config: DEFAULT_CONFIG,
    state: 'round1_active',
    teams: [{ id: 'A', gameId: 'g1', name: 'Reds', createdAt: 0 }],
    memberships: [
      { id: 'mA', gameId: 'g1', userId: 'uA', teamId: 'A', role: 'captain', returnCheckins: {} },
      { id: 'mJ', gameId: 'g1', userId: 'uJ', teamId: null, role: 'judge', returnCheckins: {} },
    ],
    photos: [photo('p0', 'A')],
    assignments: [], votes: [], createdAt: 0,
    ...overrides,
  };
}

let repo: InMemoryGameRepository;
beforeEach(async () => {
  repo = new InMemoryGameRepository();
  await repo.save(makeGame());
});

describe('requestPhotoUpload', () => {
  it('returns a presigned upload for a team member during a round', async () => {
    const res = await requestPhotoUpload(repo, media, { gameId: 'g1', teamId: 'A', userId: 'uA' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.key).toBe(`games/g1/A/${res.data.objectId}.jpg`);
      expect(res.data.upload.fields.key).toBe(res.data.key);
    }
  });

  it('rejects uploads outside a round', async () => {
    await repo.save(makeGame({ state: 'lobby' }));
    expect((await requestPhotoUpload(repo, media, { gameId: 'g1', teamId: 'A', userId: 'uA' })).ok).toBe(false);
  });

  it('rejects a non-member of the team', async () => {
    expect((await requestPhotoUpload(repo, media, { gameId: 'g1', teamId: 'A', userId: 'uJ' })).ok).toBe(false);
    expect((await requestPhotoUpload(repo, media, { gameId: 'g1', teamId: 'A', userId: 'stranger' })).ok).toBe(false);
  });

  it('rejects an unknown game', async () => {
    expect((await requestPhotoUpload(repo, media, { gameId: 'nope', teamId: 'A', userId: 'uA' })).ok).toBe(false);
  });
});

/**
 * A two-team game in Round 2 where B chases A's photo. This is the shape the
 * scoping rules are about: mid-round, the only original you may look at is the
 * one you were told to recreate.
 */
function chasingGame(overrides: Partial<Game> = {}): Game {
  return makeGame({
    state: 'round2_active',
    teams: [
      { id: 'A', gameId: 'g1', name: 'Reds', createdAt: 0 },
      { id: 'B', gameId: 'g1', name: 'Blues', createdAt: 0 },
    ],
    memberships: [
      { id: 'mA', gameId: 'g1', userId: 'uA', teamId: 'A', role: 'captain', returnCheckins: {} },
      { id: 'mB', gameId: 'g1', userId: 'uB', teamId: 'B', role: 'captain', returnCheckins: {} },
      { id: 'mJ', gameId: 'g1', userId: 'uJ', teamId: null, role: 'judge', returnCheckins: {} },
    ],
    photos: [photo('p0', 'A'), photo('pB', 'B')],
    assignments: [
      { id: 'as1', gameId: 'g1', chaserTeamId: 'B', originalPhotoId: 'p0', order: 0, chasePhotoId: null },
    ],
    ...overrides,
  });
}

describe('requestPhotoDownload', () => {
  it('returns a signed URL for the caller team’s own photo', async () => {
    const res = await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'uA' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.url).toContain('games/g1/A/p0.jpg');
      expect(res.data.url).toContain('X-Amz-Signature');
    }
  });

  it('signs the thumbnail when that variant is asked for', async () => {
    const res = await requestPhotoDownload(repo, media, {
      gameId: 'g1', photoId: 'p0', userId: 'uA', variant: 'thumb',
    });
    expect(res.ok).toBe(true);
    // 1024px is plenty to line a shot up against, and the original is allowed
    // to be 10 MB — which a team would pay for on cellular, outdoors.
    if (res.ok) expect(res.data.url).toContain('thumbs/1024/games/g1/A/p0.jpg');
  });

  it('rejects a non-participant', async () => {
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'stranger' })).ok).toBe(false);
  });

  it('rejects an unknown photo', async () => {
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'nope', userId: 'uA' })).ok).toBe(false);
  });

  // Round 2 is the first time downloads are a hot path, and what they protect is
  // the whole secret of the round: which photo you were given to recreate. Being
  // in the game used to be the entire permission.
  it('lets a chaser sign the original it was assigned', async () => {
    await repo.save(chasingGame());
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'uB' })).ok).toBe(true);
  });

  it('refuses another team’s photo that the caller was not assigned', async () => {
    await repo.save(chasingGame());
    // A was given nothing to chase, so B's original is none of A's business.
    const res = await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'pB', userId: 'uA' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not');
  });

  // Judging is the point of the later phases, so the scoping lifts there rather
  // than being carved out per role. Before then a judge has nothing to judge.
  it('refuses a judge mid-round but allows them once rating starts', async () => {
    await repo.save(chasingGame());
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'uJ' })).ok).toBe(false);

    await repo.save(chasingGame({ state: 'rating' }));
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'uJ' })).ok).toBe(true);
  });
});
