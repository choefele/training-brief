import {
  addDays, connectionState, dayKey, GarminClient, GarminError, looksLikeJwt, mergeRawActivities, NotConnectedError, parseDay, startOfDay,
  tokenFromString, withAccessToken, type ConnectionState, type CredentialStore, type HttpFetch,
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
const store: CredentialStore = { get: getCredentials, save: saveCredentials };

export type ConnectionStatus = ConnectionState;

export async function connectionStatus(): Promise<ConnectionStatus> {
  return connectionState(await getCredentials());
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

  const raw = await withAccessToken(client, store, token => client.loadActivities(token, search, { onProgress }));

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
