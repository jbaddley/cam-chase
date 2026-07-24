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

describe('requestPhotoDownload', () => {
  it('returns a signed URL for a participant (including judges)', async () => {
    const res = await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'uJ' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.url).toContain('games/g1/A/p0.jpg');
      expect(res.data.url).toContain('X-Amz-Signature');
    }
  });

  it('rejects a non-participant', async () => {
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'p0', userId: 'stranger' })).ok).toBe(false);
  });

  it('rejects an unknown photo', async () => {
    expect((await requestPhotoDownload(repo, media, { gameId: 'g1', photoId: 'nope', userId: 'uA' })).ok).toBe(false);
  });
});
