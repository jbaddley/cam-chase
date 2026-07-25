import { describe, expect, it } from 'vitest';
import { ApiError, request, type ClientConfig, type FetchFn } from './http.js';

/** Build a fetch double that records its call and returns a canned Response. */
function fakeFetch(response: Response): { fetch: FetchFn; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  };
  return { fetch, calls };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('request', () => {
  it('builds the URL, method, and default headers', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ ok: true }));
    const config: ClientConfig = { baseUrl: 'https://api.example.com', fetch };

    await request(config, 'GET', '/games/42/teams');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.example.com/games/42/teams');
    expect(calls[0]!.init?.method).toBe('GET');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json');
  });

  it('trims a trailing slash from baseUrl', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({}));
    await request({ baseUrl: 'https://api.example.com/', fetch }, 'GET', '/games');
    expect(calls[0]!.url).toBe('https://api.example.com/games');
  });

  it('serializes a JSON body and sets content-type', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ gameId: 'g1' }));
    await request({ baseUrl: 'https://api.example.com', fetch }, 'POST', '/games', { config: { teams: 2 } });

    const init = calls[0]!.init!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ config: { teams: 2 } }));
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('attaches a bearer token from getToken', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({}));
    await request({ baseUrl: 'https://api.example.com', fetch, getToken: () => 'tok-123' }, 'GET', '/games');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-123');
  });

  it('awaits an async getToken', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({}));
    await request(
      { baseUrl: 'https://api.example.com', fetch, getToken: () => Promise.resolve('async-tok') },
      'GET',
      '/games',
    );
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer async-tok');
  });

  it('omits the authorization header when there is no token', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({}));
    await request({ baseUrl: 'https://api.example.com', fetch, getToken: () => null }, 'GET', '/games');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('parses and returns the JSON body on success', async () => {
    const { fetch } = fakeFetch(jsonResponse({ gameId: 'g1', code: 'ABCD' }));
    const data = await request<{ gameId: string; code: string }>(
      { baseUrl: 'https://api.example.com', fetch },
      'POST',
      '/games',
    );
    expect(data).toEqual({ gameId: 'g1', code: 'ABCD' });
  });

  it('returns undefined for an empty body', async () => {
    const { fetch } = fakeFetch(new Response('', { status: 200 }));
    const data = await request({ baseUrl: 'https://api.example.com', fetch }, 'POST', '/games/1/start');
    expect(data).toBeUndefined();
  });

  it('throws ApiError with the server message and request id on a 4xx', async () => {
    const response = jsonResponse(
      { error: 'Game not found.', requestId: 'req-9' },
      { status: 404, headers: { 'content-type': 'application/json', 'x-request-id': 'req-9' } },
    );
    const { fetch } = fakeFetch(response);

    await expect(request({ baseUrl: 'https://api.example.com', fetch }, 'GET', '/games/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Game not found.',
      requestId: 'req-9',
    });
  });

  it('falls back to a status message when the error body has no message', async () => {
    const { fetch } = fakeFetch(new Response('', { status: 500 }));
    let caught: unknown;
    try {
      await request({ baseUrl: 'https://api.example.com', fetch }, 'GET', '/boom');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
    expect((caught as ApiError).message).toBe('Request failed with status 500');
  });
});
