import type { GarminActivity } from './types.ts';

/**
 * Client for the Garmin Connect™ Personal API.
 * Docs: https://developer.garmin.com/gc-developer-program/personal/
 *
 * The API key is personal. This client only ever sends it to Garmin's token endpoint
 * and never includes it in errors or return values.
 */

export const GARMIN_API_BASE = 'https://personal.connectapi.garmin.com';
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
export const ACTIVITIES_PATH = '/activitylist-service/activities/search/activities';
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_MAX_ACTIVITIES = 5000;

/** The parts of fetch's Response this client needs, so core runs without DOM types. */
export interface HttpResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

/** Structurally compatible with the DOM's AbortSignal. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  signal?: AbortSignalLike;
}

export type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>;

export type GarminErrorCode =
  | 'key_rejected'
  | 'token_expired'
  | 'forbidden'
  | 'not_acceptable'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'bad_response';

export class GarminError extends Error {
  readonly code: GarminErrorCode;
  readonly status: number | null;

  constructor(code: GarminErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'GarminError';
    this.code = code;
    this.status = status;
  }
}

export interface AccessToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Search parameters as the API names them. Dates are YYYY-MM-DD, local time. */
export interface ActivitySearch {
  startDate?: string;
  endDate?: string;
  search?: string;
  activityType?: string;
  minDistance?: number;
  maxDistance?: number;
  minDuration?: number;
  maxDuration?: number;
}

export interface LoadOptions {
  onProgress?: (loaded: number) => void;
  signal?: AbortSignalLike;
}

export interface GarminClientOptions {
  fetch: HttpFetch;
  baseUrl?: string;
  pageSize?: number;
  /** Stops paging after this many activities, to stay well inside Garmin's rate limits. */
  maxActivities?: number;
}

const TOKEN_FIELDS = ['access_token', 'accessToken', 'token', 'value'] as const;

/**
 * The token response format isn't documented. Accepts a bare string, a JSON string,
 * or a JSON object with access_token, accessToken, token or value.
 */
export function parseTokenResponse(body: string): string {
  const text = body.trim();
  let token: unknown = text;
  if (/^[{["]/.test(text)) {
    try {
      const json: unknown = JSON.parse(text);
      if (typeof json === 'string') token = json;
      else if (json && typeof json === 'object' && !Array.isArray(json)) {
        const obj = json as Record<string, unknown>;
        token = TOKEN_FIELDS.map(k => obj[k]).find(v => typeof v === 'string' && v.trim());
      } else token = null;
    } catch {
      token = null;
    }
  }
  // Tokens are JWTs or similar opaque strings; anything else (an HTML error page, say) isn't one.
  if (typeof token !== 'string' || !/^[\w\-.~+/=]+$/.test(token.trim())) {
    throw new GarminError('bad_response', 'Garmin answered, but the response contained no access token.');
  }
  return token.trim();
}

export const looksLikeJwt = (s: string): boolean => /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(s.trim());

function base64UrlDecode(s: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')) {
    const i = alphabet.indexOf(ch);
    if (i < 0) throw new Error('not base64url');
    value = (value << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
}

const FALLBACK_LIFETIME_MS = 23 * 3600e3;
const EXPIRY_MARGIN_MS = 60e3;

/** A JWT's `exp` minus a minute, or about 23 hours from now for opaque tokens. */
export function tokenExpiry(token: string, now: number = Date.now()): number {
  if (looksLikeJwt(token)) {
    try {
      const payload: unknown = JSON.parse(base64UrlDecode(token.split('.')[1]));
      const exp = payload && typeof payload === 'object' ? (payload as { exp?: unknown }).exp : null;
      if (typeof exp === 'number' && exp > 0) return exp * 1000 - EXPIRY_MARGIN_MS;
    } catch {
      // Not a readable JWT; fall back to Garmin's documented 24 hours.
    }
  }
  return now + FALLBACK_LIFETIME_MS;
}

export const tokenFromString = (token: string, now: number = Date.now()): AccessToken => ({ token: token.trim(), expiresAt: tokenExpiry(token.trim(), now) });

const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

export class GarminClient {
  private readonly fetch: HttpFetch;
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxActivities: number;

  constructor(options: GarminClientOptions) {
    this.fetch = options.fetch;
    this.baseUrl = (options.baseUrl ?? GARMIN_API_BASE).replace(/\/+$/, '');
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxActivities = options.maxActivities ?? DEFAULT_MAX_ACTIVITIES;
  }

  /** Trades the Personal API key for an access token that lasts up to 24 hours. */
  async requestToken(apiKey: string, signal?: AbortSignalLike): Promise<AccessToken> {
    // No Accept header: the token endpoint answers HTTP 406 to "Accept: application/json".
    const res = await this.send(TOKEN_PATH, { method: 'POST', headers: { Authorization: `ApiKey ${apiKey.trim()}` }, signal });
    if (res.status === 401 || res.status === 403) {
      throw new GarminError('key_rejected', "Garmin didn't accept this API key. Check that you copied all of it and that it hasn't expired or been deleted.", res.status);
    }
    this.throwForStatus(res, 'token');
    return tokenFromString(parseTokenResponse(await res.text()));
  }

  /** One page of the activity search. */
  async searchActivities(token: string, search: ActivitySearch, start: number, limit: number = this.pageSize, signal?: AbortSignalLike): Promise<GarminActivity[]> {
    const params: [string, unknown][] = [['start', start], ['limit', limit], ...Object.entries(search)];
    const qs = params.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const res = await this.send(`${ACTIVITIES_PATH}?${qs}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal });
    if (res.status === 401) {
      throw new GarminError('token_expired', 'Garmin no longer accepts the access token. It has probably expired; a new one needs your API key.', 401);
    }
    if (res.status === 403) {
      throw new GarminError('forbidden', "Garmin refused access to your activities (HTTP 403). The key may have been revoked or lack permission for activities.", 403);
    }
    this.throwForStatus(res, 'activities');
    let page: unknown;
    try {
      page = JSON.parse(await res.text());
    } catch {
      throw new GarminError('bad_response', 'Garmin sent activities in a format Training Brief could not read.');
    }
    if (!Array.isArray(page)) throw new GarminError('bad_response', 'Garmin returned something other than a list of activities.');
    return page as GarminActivity[];
  }

  /** Pages through the search one request at a time until a page comes back short. */
  async loadActivities(token: string, search: ActivitySearch = {}, options: LoadOptions = {}): Promise<GarminActivity[]> {
    const all: GarminActivity[] = [];
    for (let start = 0; ; start += this.pageSize) {
      const page = await this.searchActivities(token, search, start, this.pageSize, options.signal);
      all.push(...page);
      options.onProgress?.(all.length);
      if (page.length < this.pageSize || all.length >= this.maxActivities) return all;
    }
  }

  private async send(path: string, init: HttpRequest): Promise<HttpResponse> {
    try {
      return await this.fetch(this.baseUrl + path, init);
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new GarminError('network', "Couldn't reach Garmin. Check your internet connection and try again.");
    }
  }

  private throwForStatus(res: HttpResponse, what: 'token' | 'activities'): void {
    if (res.ok) return;
    if (res.status === 406) throw new GarminError('not_acceptable', `Garmin rejected the request format (HTTP 406) when asked for ${what === 'token' ? 'an access token' : 'activities'}. Please report this.`, 406);
    if (res.status === 429) throw new GarminError('rate_limited', 'Garmin is limiting requests right now. Try again in a few minutes.', 429);
    throw new GarminError('server', `Garmin couldn't ${what === 'token' ? 'issue an access token' : 'send your activities'} (HTTP ${res.status}). Try again later.`, res.status);
  }
}
