import { describe, expect, it } from 'vitest';
import { PhotoChaseClient, type PresignedPost } from './client.js';
import type { ClientConfig, FetchFn } from './http.js';
import { DEFAULT_CONFIG } from '@photochase/shared';

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fetch double that records calls and replies with a canned JSON body. */
function recorder(body: unknown, init: ResponseInit = { status: 200 }): { config: ClientConfig; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = (url, requestInit) => {
    calls.push({ url, init: requestInit });
    const payload = body === undefined ? '' : JSON.stringify(body);
    return Promise.resolve(new Response(payload, { headers: { 'content-type': 'application/json' }, ...init }));
  };
  return { config: { baseUrl: 'https://api.example.com', fetch }, calls };
}

describe('PhotoChaseClient', () => {
  it('createGame POSTs /games with the config body', async () => {
    const { config, calls } = recorder({ gameId: 'g1', code: 'ABCD' });
    const result = await new PhotoChaseClient(config).createGame(DEFAULT_CONFIG);

    expect(calls[0]!.url).toBe('https://api.example.com/games');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ config: DEFAULT_CONFIG }));
    expect(result).toEqual({ gameId: 'g1', code: 'ABCD' });
  });

  it('joinGame POSTs /games/join with the join action', async () => {
    const { config, calls } = recorder({ gameId: 'g1', teamId: 't1', role: 'captain' });
    const result = await new PhotoChaseClient(config).joinGame({
      code: 'ABCD',
      displayName: 'Ada',
      action: { type: 'create_team', name: 'Reds' },
    });

    expect(calls[0]!.url).toBe('https://api.example.com/games/join');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      code: 'ABCD',
      displayName: 'Ada',
      action: { type: 'create_team', name: 'Reds' },
    });
    expect(result).toEqual({ gameId: 'g1', teamId: 't1', role: 'captain' });
  });

  it('listTeams GETs the team list and url-encodes the id', async () => {
    const { config, calls } = recorder([{ teamId: 't1', name: 'Reds', memberCount: 3 }]);
    const teams = await new PhotoChaseClient(config).listTeams('game/1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/game%2F1/teams');
    expect(calls[0]!.init?.method).toBe('GET');
    expect(teams).toEqual([{ teamId: 't1', name: 'Reds', memberCount: 3 }]);
  });

  it('getGame GETs the sanitized game state', async () => {
    const view = {
      id: 'g1',
      code: 'ABCD',
      state: 'lobby',
      config: DEFAULT_CONFIG,
      teams: [{ teamId: 't1', name: 'Reds', memberCount: 2 }],
      playerCount: 2,
    };
    const { config, calls } = recorder(view);
    const result = await new PhotoChaseClient(config).getGame('g1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1');
    expect(calls[0]!.init?.method).toBe('GET');
    expect(result).toEqual(view);
  });

  it('startGame POSTs /start with no body', async () => {
    const { config, calls } = recorder({ state: 'round1_active' });
    const result = await new PhotoChaseClient(config).startGame('g1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/start');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBeUndefined();
    expect(result).toEqual({ state: 'round1_active' });
  });

  it('advanceGame POSTs the event', async () => {
    const { config, calls } = recorder({ state: 'round1_return' });
    const result = await new PhotoChaseClient(config).advanceGame('g1', 'END_ROUND1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/advance');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ event: 'END_ROUND1' });
    expect(result).toEqual({ state: 'round1_return' });
  });

  it('submitPhoto POSTs the capture to /photos', async () => {
    const { config, calls } = recorder({ photoId: 'p1' });
    const result = await new PhotoChaseClient(config).submitPhoto('g1', {
      teamId: 't1',
      location: { lat: 1, lng: 2 },
      s3Key: 'games/g1/p1.jpg',
    });

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/photos');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      teamId: 't1',
      location: { lat: 1, lng: 2 },
      s3Key: 'games/g1/p1.jpg',
    });
    expect(result).toEqual({ photoId: 'p1' });
  });

  it('submitChase POSTs to /chases', async () => {
    const { config, calls } = recorder({ chasePhotoId: 'c1' });
    const result = await new PhotoChaseClient(config).submitChase('g1', {
      assignmentId: 'a1',
      location: { lat: 3, lng: 4 },
      s3Key: 'games/g1/c1.jpg',
    });

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/chases');
    expect(result).toEqual({ chasePhotoId: 'c1' });
  });

  it('castVote POSTs to /votes', async () => {
    const { config, calls } = recorder({ voteId: 'v1' });
    const result = await new PhotoChaseClient(config).castVote('g1', {
      assignmentId: 'a1',
      axis: 'pose',
      stars: 5,
    });

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/votes');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ assignmentId: 'a1', axis: 'pose', stars: 5 });
    expect(result).toEqual({ voteId: 'v1' });
  });

  it('getResults GETs the scoreboard', async () => {
    const { config, calls } = recorder({ scoreboard: [] });
    const result = await new PhotoChaseClient(config).getResults('g1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/results');
    expect(calls[0]!.init?.method).toBe('GET');
    expect(result).toEqual({ scoreboard: [] });
  });

  it('requestUpload POSTs the team id and returns the presigned target', async () => {
    const target = { objectId: 'o1', key: 'games/g1/o1', upload: { url: 'https://s3', fields: { key: 'games/g1/o1' } } };
    const { config, calls } = recorder(target);
    const result = await new PhotoChaseClient(config).requestUpload('g1', 't1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/uploads');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ teamId: 't1' });
    expect(result).toEqual(target);
  });

  it('requestDownload POSTs the photo id', async () => {
    const { config, calls } = recorder({ url: 'https://s3/get' });
    const result = await new PhotoChaseClient(config).requestDownload('g1', 'p1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/downloads');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ photoId: 'p1' });
    expect(result).toEqual({ url: 'https://s3/get' });
  });

  it('listAssignments GETs the Round 2 queue', async () => {
    const queue = [
      { assignmentId: 'a1', order: 0, originalPhotoId: 'p1', originalPhotoKey: 'games/g1/t2/p1.jpg', chasePhotoId: null },
    ];
    const { config, calls } = recorder(queue);
    const result = await new PhotoChaseClient(config).listAssignments('g1');

    expect(calls[0]!.url).toBe('https://api.example.com/games/g1/assignments');
    expect(calls[0]!.init?.method).toBe('GET');
    expect(result).toEqual(queue);
  });

  describe('captureChase', () => {
    it('threads the presigned key through upload and submitChase', async () => {
      const calls: Call[] = [];
      const s3Url = 'https://bucket.s3.amazonaws.com/';
      const key = 'games/g1/t1/chase-abc.jpg';
      const fetch: FetchFn = (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/uploads')) {
          return Promise.resolve(
            new Response(JSON.stringify({ objectId: 'o1', key, upload: { url: s3Url, fields: { key } } }), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url === s3Url) return Promise.resolve(new Response(null, { status: 204 }));
        if (url.endsWith('/chases')) {
          return Promise.resolve(
            new Response(JSON.stringify({ chasePhotoId: 'c1' }), { headers: { 'content-type': 'application/json' } }),
          );
        }
        return Promise.resolve(new Response('nope', { status: 404 }));
      };

      const client = new PhotoChaseClient({ baseUrl: 'https://api.example.com', fetch });
      const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

      const result = await client.captureChase('g1', {
        teamId: 't1',
        assignmentId: 'a1',
        location: { lat: 5, lng: 6 },
        file,
      });

      expect(calls.map((c) => c.url)).toEqual([
        'https://api.example.com/games/g1/uploads',
        s3Url,
        'https://api.example.com/games/g1/chases',
      ]);
      expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({
        assignmentId: 'a1',
        location: { lat: 5, lng: 6 },
        s3Key: key,
      });
      expect(result).toEqual({ chasePhotoId: 'c1', key });
    });
  });

  describe('capturePhoto', () => {
    it('threads the presigned key through upload and submit', async () => {
      const calls: Call[] = [];
      const s3Url = 'https://bucket.s3.amazonaws.com/';
      const key = 'games/g1/t1/photo-abc.jpg';
      const fetch: FetchFn = (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/uploads')) {
          return Promise.resolve(
            new Response(JSON.stringify({ objectId: 'o1', key, upload: { url: s3Url, fields: { key } } }), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url === s3Url) return Promise.resolve(new Response(null, { status: 204 }));
        if (url.endsWith('/photos')) {
          return Promise.resolve(
            new Response(JSON.stringify({ photoId: 'p1' }), { headers: { 'content-type': 'application/json' } }),
          );
        }
        return Promise.resolve(new Response('nope', { status: 404 }));
      };

      const client = new PhotoChaseClient({ baseUrl: 'https://api.example.com', fetch });
      const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

      const result = await client.capturePhoto('g1', { teamId: 't1', location: { lat: 1, lng: 2 }, file });

      // Three calls, in order: uploads → S3 → photos.
      expect(calls.map((c) => c.url)).toEqual([
        'https://api.example.com/games/g1/uploads',
        s3Url,
        'https://api.example.com/games/g1/photos',
      ]);
      // The submitted s3Key is the key minted by the upload step.
      expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({
        teamId: 't1',
        location: { lat: 1, lng: 2 },
        s3Key: key,
      });
      expect(result).toEqual({ photoId: 'p1', key });
    });

    it('does not submit metadata if the S3 upload fails', async () => {
      const calls: Call[] = [];
      const s3Url = 'https://bucket.s3.amazonaws.com/';
      const fetch: FetchFn = (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/uploads')) {
          return Promise.resolve(
            new Response(JSON.stringify({ objectId: 'o1', key: 'k', upload: { url: s3Url, fields: {} } }), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url === s3Url) return Promise.resolve(new Response('denied', { status: 403 }));
        return Promise.resolve(new Response('nope', { status: 404 }));
      };

      const client = new PhotoChaseClient({ baseUrl: 'https://api.example.com', fetch });
      const file = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });

      await expect(client.capturePhoto('g1', { teamId: 't1', location: { lat: 1, lng: 2 }, file })).rejects.toThrow('403');
      expect(calls.some((c) => c.url.endsWith('/photos'))).toBe(false);
    });
  });

  describe('uploadPhoto', () => {
    const post: PresignedPost = {
      url: 'https://bucket.s3.amazonaws.com/',
      fields: { key: 'games/g1/o1.jpg', 'Content-Type': 'image/jpeg', policy: 'abc' },
    };

    it('posts the presigned form with the fields first and the file last', async () => {
      const calls: Call[] = [];
      const fetch: FetchFn = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(null, { status: 204 }));
      };
      const client = new PhotoChaseClient({ baseUrl: 'https://api.example.com', fetch });
      const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

      await client.uploadPhoto(post, file);

      expect(calls[0]!.url).toBe(post.url);
      expect(calls[0]!.init?.method).toBe('POST');
      const form = calls[0]!.init?.body as FormData;
      const names = [...form.keys()];
      expect(names).toEqual(['key', 'Content-Type', 'policy', 'file']);
      expect(form.get('key')).toBe('games/g1/o1.jpg');
      expect(form.get('file')).toBeInstanceOf(Blob);
    });

    it('throws when S3 rejects the upload', async () => {
      const fetch: FetchFn = () => Promise.resolve(new Response('denied', { status: 403 }));
      const client = new PhotoChaseClient({ baseUrl: 'https://api.example.com', fetch });
      const file = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });

      await expect(client.uploadPhoto(post, file)).rejects.toThrow('403');
    });
  });
});
