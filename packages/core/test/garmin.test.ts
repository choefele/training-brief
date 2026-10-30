import { describe, expect, it, vi } from 'vitest';
import { GarminClient, GarminError, parseTokenResponse, tokenExpiry, type HttpFetch, type HttpRequest } from '../src/index.ts';
import { jwt, manyRuns, reply } from './fixtures.ts';

const BASE = 'https://personal.connectapi.garmin.com';

function client(responses: Array<ReturnType<typeof reply> | Error>, pageSize = 100) {
  const calls: Array<{ url: string; init: HttpRequest }> = [];
  const fetch: HttpFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  return { api: new GarminClient({ fetch, pageSize }), calls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(GarminError);
    return (err as GarminError).code;
  }
  throw new Error('expected an error');
}

describe('parseTokenResponse', () => {
  const t = jwt({ exp: 2000000000 });
  it.each([
    ['a bare string', t],
    ['a bare string with whitespace', `  ${t}\n`],
    ['a JSON string', JSON.stringify(t)],
    ['access_token', JSON.stringify({ access_token: t, expires_in: 86400 })],
    ['accessToken', JSON.stringify({ accessToken: t })],
    ['token', JSON.stringify({ token: t })],
    ['value', JSON.stringify({ value: t })],
  ])('reads %s', (_, body) => expect(parseTokenResponse(body)).toBe(t));

  it.each([
    ['an empty body', ''],
    ['an object without a token', '{"expires_in":86400}'],
    ['an array', '["abc"]'],
    ['broken JSON', '{"access_token":'],
    ['an HTML page', '<html><body>Error</body></html>'],
  ])('rejects %s', (_, body) => expect(() => parseTokenResponse(body)).toThrow(GarminError));
});

describe('tokenExpiry', () => {
  it("uses a JWT's exp minus a minute", () => {
    expect(tokenExpiry(jwt({ exp: 2000000000 }), 0)).toBe(2000000000 * 1000 - 60000);
  });

  it('assumes about 23 hours for other tokens', () => {
    expect(tokenExpiry('opaque-token', 1000)).toBe(1000 + 23 * 3600e3);
    expect(tokenExpiry(jwt({ sub: 'x' }), 1000)).toBe(1000 + 23 * 3600e3);
  });
});

describe('requestToken', () => {
  it('posts the key without an Accept header and returns the token', async () => {
    const t = jwt({ exp: 2000000000 });
    const { api, calls } = client([reply(200, { access_token: t })]);
    const token = await api.requestToken(' my-key ');
    expect(token).toEqual({ token: t, expiresAt: 2000000000 * 1000 - 60000 });
    expect(calls[0].url).toBe(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: 'ApiKey my-key' });
  });

  it.each([401, 403])('reports a rejected key for HTTP %i', async status => {
    const { api } = client([reply(status, 'Unauthorized')]);
    expect(await codeOf(api.requestToken('k'))).toBe('key_rejected');
  });

  it.each([[406, 'not_acceptable'], [429, 'rate_limited'], [500, 'server']])('maps HTTP %i to %s', async (status, code) => {
    const { api } = client([reply(status, '')]);
    expect(await codeOf(api.requestToken('k'))).toBe(code);
  });

  it('reports network failures', async () => {
    const { api } = client([new TypeError('Failed to fetch')]);
    expect(await codeOf(api.requestToken('k'))).toBe('network');
  });

  it('never puts the key in an error message', async () => {
    for (const r of [reply(401, ''), reply(500, ''), reply(200, '{}'), new TypeError('Failed to fetch')]) {
      const { api } = client([r]);
      await api.requestToken('super-secret-key').catch((err: Error) => expect(err.message).not.toContain('super-secret-key'));
    }
  });
});

describe('loadActivities', () => {
  it('pages until a short page and sends the search parameters', async () => {
    const { api, calls } = client([reply(200, manyRuns(100)), reply(200, manyRuns(100, 100)), reply(200, manyRuns(37, 200))]);
    const progress: number[] = [];
    const all = await api.loadActivities('tok', { startDate: '2026-09-01', endDate: '2026-10-29' }, { onProgress: n => progress.push(n) });
    expect(all).toHaveLength(237);
    expect(progress).toEqual([100, 200, 237]);
    expect(calls.map(c => new URL(c.url).searchParams.get('start'))).toEqual(['0', '100', '200']);
    const first = new URL(calls[0].url);
    expect(first.origin + first.pathname).toBe(`${BASE}/activitylist-service/activities/search/activities`);
    expect(first.searchParams.get('limit')).toBe('100');
    expect(first.searchParams.get('startDate')).toBe('2026-09-01');
    expect(first.searchParams.get('endDate')).toBe('2026-10-29');
    expect(calls[0].init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
    expect(Object.keys(calls[0].init.headers)).toEqual(['Authorization']);
  });

  it('stops after an empty page', async () => {
    const { api, calls } = client([reply(200, manyRuns(2)), reply(200, [])], 2);
    expect(await api.loadActivities('tok')).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('stops at the activity cap', async () => {
    const fetch: HttpFetch = vi.fn(async () => reply(200, manyRuns(10)));
    const api = new GarminClient({ fetch, pageSize: 10, maxActivities: 30 });
    expect(await api.loadActivities('tok')).toHaveLength(30);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, 'token_expired'], [403, 'forbidden'], [406, 'not_acceptable'], [429, 'rate_limited'], [503, 'server'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { api } = client([reply(status, '')]);
    expect(await codeOf(api.loadActivities('tok'))).toBe(code);
  });

  it('fails on a later page without returning partial data', async () => {
    const { api } = client([reply(200, manyRuns(100)), reply(429, '')]);
    expect(await codeOf(api.loadActivities('tok'))).toBe('rate_limited');
  });

  it('reports network failures', async () => {
    const { api } = client([new TypeError('Failed to fetch')]);
    expect(await codeOf(api.loadActivities('tok'))).toBe('network');
  });

  it('rejects responses that are not a list', async () => {
    const { api } = client([reply(200, { error: 'nope' })]);
    expect(await codeOf(api.loadActivities('tok'))).toBe('bad_response');
    const { api: api2 } = client([reply(200, 'not json')]);
    expect(await codeOf(api2.loadActivities('tok'))).toBe('bad_response');
  });

  it('passes aborts through', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { api } = client([abort]);
    await expect(api.loadActivities('tok')).rejects.toBe(abort);
  });
});
