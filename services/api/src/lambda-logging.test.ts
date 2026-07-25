import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, type Container } from './container.js';
import { Logger, type LogRecord } from './logger.js';
import { route } from './lambda.js';
import type { GameRepository } from './repository.js';

function event(method: string, path: string, requestId: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: path,
    headers: {},
    requestContext: { http: { method, path }, requestId, authorizer: { jwt: { claims: { sub: 'u1' } } } } as unknown as APIGatewayProxyEventV2['requestContext'],
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

let records: LogRecord[];
let container: Container;
beforeEach(() => {
  records = [];
  container = { ...buildContainer({} as NodeJS.ProcessEnv), logger: new Logger((r) => records.push(r)) };
});

const header = (res: { headers?: unknown }, name: string) => (res.headers as Record<string, unknown>)[name];

describe('router logging middleware', () => {
  it('logs request.start and request.end and stamps x-request-id', async () => {
    const res = await route(event('POST', '/webhooks/purchase', 'req-1', { userId: 'u', event: { type: 'game_pack_purchased', credits: 1 } }), container);
    expect(res.statusCode).toBe(200);
    expect(header(res, 'x-request-id')).toBe('req-1');

    const msgs = records.map((r) => r.msg);
    expect(msgs).toContain('request.start');
    const end = records.find((r) => r.msg === 'request.end')!;
    expect(end).toMatchObject({ status: 200, requestId: 'req-1', method: 'POST', path: '/webhooks/purchase' });
    expect(typeof end.durationMs).toBe('number');
  });

  it('includes requestId in error bodies (404)', async () => {
    const res = await route(event('GET', '/nope', 'req-2'), container);
    expect(res.statusCode).toBe(404);
    expect(header(res, 'x-request-id')).toBe('req-2');
    expect(JSON.parse(res.body as string).requestId).toBe('req-2');
  });

  it('logs request.error with a stack on a handler throw', async () => {
    const boomGames: GameRepository = {
      get: async () => {
        throw new Error('boom');
      },
      save: async () => {},
      getByCode: async () => null,
    };
    const c: Container = { ...container, games: boomGames };
    const res = await route(event('GET', '/games/g1/results', 'req-3'), c);
    expect(res.statusCode).toBe(500);
    const errRecord = records.find((r) => r.msg === 'request.error')!;
    expect(errRecord).toMatchObject({ level: 'error', error: 'boom', requestId: 'req-3' });
    expect(typeof errRecord.stack).toBe('string');
    expect((JSON.parse(res.body as string) as { requestId: string }).requestId).toBe('req-3');
  });

  it('generates a request id when the event lacks one', async () => {
    const e = event('GET', '/nope', '');
    (e.requestContext as { requestId?: string }).requestId = undefined;
    const res = await route(e, container);
    expect(typeof header(res, 'x-request-id')).toBe('string');
    expect((header(res, 'x-request-id') as string).length).toBeGreaterThan(0);
  });
});
