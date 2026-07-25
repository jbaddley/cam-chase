/**
 * HTTP foundation for the PhotoChase API client. JSON in/out, bearer auth, and
 * structured errors. `fetch` is injectable so the client is fully unit-testable.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientConfig {
  baseUrl: string;
  /** Supplies the current auth token (Cognito access token), if any. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Override fetch (defaults to the global). */
  fetch?: FetchFn;
}

/** Thrown on non-2xx responses; carries the server's message and request id. */
export class ApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Perform a JSON request and return the parsed body, or throw ApiError. */
export async function request<T>(
  config: ClientConfig,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const doFetch = config.fetch ?? (globalThis.fetch as FetchFn);
  const headers: Record<string, string> = { accept: 'application/json' };

  const token = config.getToken ? await config.getToken() : undefined;
  if (token) headers.authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
  const res = await doFetch(url, init);
  const requestId = res.headers.get('x-request-id') ?? undefined;

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const errorField = (data as { error?: unknown } | undefined)?.error;
    const message = typeof errorField === 'string' ? errorField : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, requestId);
  }
  return data as T;
}
