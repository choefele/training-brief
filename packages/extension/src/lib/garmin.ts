import {
  addDays, dayKey, GarminClient, GarminError, looksLikeJwt, mergeRawActivities, parseDay, startOfDay, tokenFromString,
  type AccessToken, type HttpFetch,
} from '@training-brief/core';
import { clearCredentials, getCredentials, getData, saveCredentials, saveData, type Credentials, type StoredData } from './storage.ts';

/** Without an earlier date asked for, a first load covers the last year. */
const DEFAULT_HISTORY_DAYS = 365;
/** A refresh reloads the last few days too, so edits and late uploads show up. */
const REFRESH_OVERLAP_DAYS = 3;

// Extension pages may call Garmin directly thanks to host_permissions. No cookies, no Accept header.
const extensionFetch: HttpFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, signal: init.signal as AbortSignal | undefined, credentials: 'omit', cache: 'no-store' });

const client = new GarminClient({ fetch: extensionFetch });

export class NotConnectedError extends Error {
  constructor(message = 'Connect your Garmin account first.') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export interface ConnectionStatus {
  connected: boolean;
  hasKey: boolean;
  token: AccessToken | null;
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const c = await getCredentials();
  const token = c?.token && c.token.expiresAt > Date.now() ? c.token : null;
  return { connected: !!(c?.apiKey || token), hasKey: !!c?.apiKey, token };
}

/**
 * Saves what the user pasted. A key is checked by trading it for a token right away;
 * a pasted token (auto-detected as a JWT, or flagged by the user) is stored as is.
 */
export async function connect(secret: string, { isToken = looksLikeJwt(secret) } = {}): Promise<Credentials> {
  const value = secret.trim();
  if (!value) throw new NotConnectedError('Paste your Personal API key first.');
  const credentials: Credentials = isToken ? { apiKey: null, token: tokenFromString(value) } : { apiKey: value, token: await client.requestToken(value) };
  await saveCredentials(credentials);
  return credentials;
}

export async function disconnect(): Promise<void> {
  await clearCredentials();
}

async function validToken(forceNew = false): Promise<string> {
  const c = await getCredentials();
  if (!c) throw new NotConnectedError();
  if (!forceNew && c.token && c.token.expiresAt > Date.now()) return c.token.token;
  if (!c.apiKey) {
    await saveCredentials({ ...c, token: null });
    throw new NotConnectedError('Your Garmin access token has expired. Paste your API key, or a new token, in Settings.');
  }
  const token = await client.requestToken(c.apiKey);
  await saveCredentials({ ...c, token });
  return token.token;
}

export interface LoadResult {
  data: StoredData;
  added: number;
}

/**
 * Loads activities on request, one page at a time. The first load, or one that reaches further back than
 * what's stored, fetches everything from `neededFrom` (at least a year); later loads only fetch recent days.
 */
export async function loadFromGarmin(neededFrom: Date | null, onProgress?: (loaded: number) => void): Promise<LoadResult> {
  const today = startOfDay(new Date());
  const existing = await getData();
  const wanted = neededFrom && neededFrom < addDays(today, -DEFAULT_HISTORY_DAYS) ? startOfDay(neededFrom) : addDays(today, -DEFAULT_HISTORY_DAYS);
  const covered = existing ? parseDay(existing.coveredFrom) : null;
  const incremental = !!existing && !!covered && covered <= (neededFrom ? startOfDay(neededFrom) : covered);
  const startDate = incremental ? dayKey(addDays(today, -REFRESH_OVERLAP_DAYS)) : dayKey(wanted);
  const search = { startDate, endDate: dayKey(today) };

  let raw;
  try {
    raw = await client.loadActivities(await validToken(), search, { onProgress });
  } catch (err) {
    if (!(err instanceof GarminError) || err.code !== 'token_expired') throw err;
    // The stored token stopped working early. With a key we can get a new one once; without, the user has to paste one.
    raw = await client.loadActivities(await validToken(true), search, { onProgress }).catch(async (again: unknown) => {
      if (again instanceof GarminError && again.code === 'token_expired') {
        const c = await getCredentials();
        if (c) await saveCredentials({ ...c, token: null });
      }
      throw again;
    });
  }

  let merged = raw;
  if (incremental && existing) {
    // Replace the refreshed days completely, so activities deleted in Garmin Connect disappear too.
    const keep = existing.raw.filter(a => (a.startTimeLocal ?? '') < startDate);
    merged = mergeRawActivities(keep, raw);
  }
  const data: StoredData = { raw: merged, loadedAt: Date.now(), coveredFrom: incremental && existing ? existing.coveredFrom : startDate };
  await saveData(data);
  return { data, added: incremental && existing ? merged.length - existing.raw.length : merged.length };
}

export function describeError(err: unknown): string {
  if (err instanceof GarminError || err instanceof NotConnectedError) return err.message;
  if (err instanceof Error && /quota/i.test(err.message)) return 'Loaded, but there was no room to store this many activities. Turn off "Remember loaded activities" or choose a shorter period.';
  return 'Something went wrong while loading from Garmin. Try again in a moment.';
}
