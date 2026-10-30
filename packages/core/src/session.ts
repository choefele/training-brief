import { GarminError, type AccessToken, type GarminClient } from './garmin.ts';

/** What a host stores to talk to Garmin. Kept out of exports and logs. */
export interface Credentials {
  /** The Personal API key, or null when the user pasted only an access token. */
  apiKey: string | null;
  token: AccessToken | null;
  /** Epoch ms when Garmin last refused the key (or the pasted token). Cleared by saving new credentials. */
  rejectedAt?: number | null;
}

export interface CredentialStore {
  get(): Promise<Credentials | null>;
  save(credentials: Credentials): Promise<void>;
}

export class NotConnectedError extends Error {
  constructor(message = 'Connect your Garmin account first.') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export const KEY_REJECTED_MESSAGE = 'Garmin no longer accepts your saved key. Paste a new one in Settings.';

export interface ConnectionState {
  /** A key or a still-valid token is stored and Garmin hasn't refused it. */
  connected: boolean;
  hasKey: boolean;
  /** Garmin refused the stored key or token; the user has to paste a new one. */
  rejected: boolean;
  token: AccessToken | null;
}

export function connectionState(c: Credentials | null, now = Date.now()): ConnectionState {
  const token = c?.token && c.token.expiresAt > now ? c.token : null;
  const rejected = !!c?.rejectedAt;
  return { connected: !rejected && !!(c?.apiKey || token), hasKey: !!c?.apiKey, rejected, token };
}

/** Errors that mean the stored key or token itself is no good, not that Garmin is briefly unavailable. */
const isRefusal = (err: unknown): boolean => err instanceof GarminError && (err.code === 'key_rejected' || err.code === 'forbidden');
const isExpired = (err: unknown): boolean => err instanceof GarminError && err.code === 'token_expired';

/**
 * Runs `request` with a valid access token. A stored token that Garmin stops accepting early is
 * replaced once using the key. When Garmin refuses the key or token, that is remembered so the
 * UI can ask for a new one instead of retrying a dead key on every load.
 */
export async function withAccessToken<T>(
  client: Pick<GarminClient, 'requestToken'>,
  store: CredentialStore,
  request: (token: string) => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const c = await store.get();
  if (!c) throw new NotConnectedError();
  if (c.rejectedAt) throw new NotConnectedError(KEY_REJECTED_MESSAGE);

  const markRejected = async (err: unknown): Promise<never> => {
    await store.save({ ...c, token: null, rejectedAt: now() });
    throw err;
  };

  const freshToken = async (): Promise<string> => {
    if (!c.apiKey) {
      await store.save({ ...c, token: null });
      throw new NotConnectedError('Your Garmin access token has expired. Paste your API key, or a new token, in Settings.');
    }
    let token: AccessToken;
    try {
      token = await client.requestToken(c.apiKey);
    } catch (err) {
      if (isRefusal(err)) return markRejected(err);
      throw err;
    }
    c.token = token;
    await store.save({ ...c });
    return token.token;
  };

  const stored = c.token && c.token.expiresAt > now() ? c.token.token : null;
  const token = stored ?? (await freshToken());
  try {
    return await request(token);
  } catch (err) {
    // Only a token from storage gets a second chance; a fresh one that's refused right away points at the key.
    if (!isExpired(err) || !stored) {
      if (isRefusal(err) || isExpired(err)) return markRejected(err);
      throw err;
    }
  }
  const again = await freshToken();
  try {
    return await request(again);
  } catch (err) {
    if (isRefusal(err) || isExpired(err)) return markRejected(err);
    throw err;
  }
}
