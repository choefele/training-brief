import { describe, expect, it, vi } from 'vitest';
import {
  connectionState, GarminError, KEY_REJECTED_MESSAGE, NotConnectedError, withAccessToken,
  type AccessToken, type Credentials, type CredentialStore,
} from '../src/index.ts';

const NOW = 1_800_000_000_000;
const now = () => NOW;
const token = (name: string, expiresAt = NOW + 3_600_000): AccessToken => ({ token: name, expiresAt });

function memoryStore(initial: Credentials | null): CredentialStore & { current: Credentials | null } {
  const store = {
    current: initial,
    get: async () => (store.current ? { ...store.current } : null),
    save: async (c: Credentials) => {
      store.current = { ...c };
    },
  };
  return store;
}

function tokenClient(...results: Array<AccessToken | GarminError>) {
  return {
    requestToken: vi.fn(async () => {
      const next = results.shift();
      if (!next) throw new Error('unexpected token request');
      if (next instanceof GarminError) throw next;
      return next;
    }),
  };
}

const expired = () => new GarminError('token_expired', 'expired', 401);
const rejected = () => new GarminError('key_rejected', 'rejected', 401);
const forbidden = () => new GarminError('forbidden', 'forbidden', 403);

describe('withAccessToken', () => {
  it('uses a stored token that is still valid', async () => {
    const store = memoryStore({ apiKey: 'key', token: token('stored') });
    const client = tokenClient();
    const request = vi.fn(async (t: string) => `data with ${t}`);

    await expect(withAccessToken(client, store, request, now)).resolves.toBe('data with stored');
    expect(client.requestToken).not.toHaveBeenCalled();
  });

  it('trades the key for a token when none is stored and saves it', async () => {
    const store = memoryStore({ apiKey: 'key', token: null });
    const client = tokenClient(token('fresh'));

    await expect(withAccessToken(client, store, async t => t, now)).resolves.toBe('fresh');
    expect(store.current?.token?.token).toBe('fresh');
  });

  it('replaces a stored token that Garmin stopped accepting early, once', async () => {
    const store = memoryStore({ apiKey: 'key', token: token('stored') });
    const client = tokenClient(token('fresh'));
    const request = vi.fn(async (t: string) => {
      if (t === 'stored') throw expired();
      return t;
    });

    await expect(withAccessToken(client, store, request, now)).resolves.toBe('fresh');
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.current).toMatchObject({ token: { token: 'fresh' } });
    expect(store.current?.rejectedAt).toBeFalsy();
  });

  it('marks the key rejected when Garmin refuses it while renewing the token', async () => {
    const store = memoryStore({ apiKey: 'key', token: token('stored') });
    const client = tokenClient(rejected());
    const request = vi.fn(async () => {
      throw expired();
    });

    await expect(withAccessToken(client, store, request, now)).rejects.toMatchObject({ code: 'key_rejected' });
    expect(store.current).toEqual({ apiKey: 'key', token: null, rejectedAt: NOW });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('marks the key rejected when Garmin refuses access to activities', async () => {
    const store = memoryStore({ apiKey: 'key', token: token('stored') });

    await expect(withAccessToken(tokenClient(), store, async () => { throw forbidden(); }, now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.current?.rejectedAt).toBe(NOW);
  });

  it('marks the key rejected when a token fresh from the key is refused right away', async () => {
    const store = memoryStore({ apiKey: 'key', token: null });
    const request = vi.fn(async () => {
      throw expired();
    });

    await expect(withAccessToken(tokenClient(token('fresh')), store, request, now)).rejects.toMatchObject({ code: 'token_expired' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.current?.rejectedAt).toBe(NOW);
  });

  it('does not contact Garmin again once the key was rejected', async () => {
    const store = memoryStore({ apiKey: 'key', token: null, rejectedAt: NOW - 1000 });
    const client = tokenClient();
    const request = vi.fn(async () => 'data');

    await expect(withAccessToken(client, store, request, now)).rejects.toThrow(KEY_REJECTED_MESSAGE);
    expect(client.requestToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for a new token when a pasted token expires and there is no key', async () => {
    const store = memoryStore({ apiKey: null, token: token('pasted') });

    await expect(withAccessToken(tokenClient(), store, async () => { throw expired(); }, now)).rejects.toBeInstanceOf(NotConnectedError);
    expect(store.current).toEqual({ apiKey: null, token: null });
  });

  it('keeps the credentials on network and server errors', async () => {
    const before: Credentials = { apiKey: 'key', token: token('stored') };
    const store = memoryStore(before);

    await expect(withAccessToken(tokenClient(), store, async () => { throw new GarminError('server', 'down', 503); }, now)).rejects.toMatchObject({ code: 'server' });
    expect(store.current).toEqual(before);
  });

  it('keeps the credentials when renewing the token fails for a network error', async () => {
    const store = memoryStore({ apiKey: 'key', token: null });

    await expect(withAccessToken(tokenClient(new GarminError('network', 'offline')), store, async t => t, now)).rejects.toMatchObject({ code: 'network' });
    expect(store.current?.rejectedAt).toBeFalsy();
  });

  it('needs credentials', async () => {
    await expect(withAccessToken(tokenClient(), memoryStore(null), async t => t, now)).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe('connectionState', () => {
  it('is connected with a key, even without a token', () => {
    expect(connectionState({ apiKey: 'key', token: null }, NOW)).toMatchObject({ connected: true, hasKey: true, rejected: false });
  });

  it('is connected with a valid pasted token only', () => {
    expect(connectionState({ apiKey: null, token: token('t') }, NOW)).toMatchObject({ connected: true, hasKey: false });
  });

  it('is not connected once a pasted token has expired', () => {
    expect(connectionState({ apiKey: null, token: token('t', NOW - 1) }, NOW)).toMatchObject({ connected: false, token: null });
  });

  it('is not connected but rejected after Garmin refused the key', () => {
    expect(connectionState({ apiKey: 'key', token: null, rejectedAt: NOW }, NOW)).toMatchObject({ connected: false, hasKey: true, rejected: true });
  });

  it('is not connected without credentials', () => {
    expect(connectionState(null, NOW)).toMatchObject({ connected: false, rejected: false });
  });
});
