/** Date and number formatting. All dates are local wall-clock time, the way Garmin reports startTimeLocal. */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 864e5;

export const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. */
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** The Monday that starts the week containing d. */
export function monday(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - weekdayIndex(x));
  return x;
}

/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export const daysBetween = (from: Date, to: Date): number => Math.round((+startOfDay(to) - +startOfDay(from)) / DAY_MS);

/** Parses YYYY-MM-DD as local midnight. */
export function parseDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Parses Garmin's "yyyy-MM-dd HH:mm:ss" (or ISO without zone) as local time. */
export function parseLocal(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) : null;
}

export const fmtDate = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const fmtShort = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const fmtTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Mon 27 Oct – Sun 2 Nov 2026"; the year appears on both ends only when the span crosses New Year. */
export function fmtSpan(first: Date, last: Date): string {
  const day = (d: Date): string => `${WEEKDAYS[weekdayIndex(d)]} ${fmtShort(d)}`;
  if (daysBetween(first, last) === 0) return `${day(first)} ${first.getFullYear()}`;
  if (first.getFullYear() !== last.getFullYear()) return `${day(first)} ${first.getFullYear()} – ${day(last)} ${last.getFullYear()}`;
  return `${day(first)} – ${day(last)} ${last.getFullYear()}`;
}

/** Which days of a chart bar a chart actually counts. */
export interface BinSpan {
  /** First and last day counted (inclusive). */
  first: Date;
  last: Date;
  /** Days counted, and days in the whole week or month. */
  days: number;
  totalDays: number;
  /** Every day of the bin is counted. */
  full: boolean;
  /** The selected range starts after the bin does. */
  startsLate: boolean;
  /** The selected range ends before the bin does. */
  endsEarly: boolean;
  /** The bin runs past today, so days are still to come. */
  inProgress: boolean;
}

/**
 * Clips the bin [start, end) to the chart window [from, to) and to today.
 * Charts group by whole weeks or months, so the first and last bars often count fewer days.
 */
export function binSpan(start: Date, end: Date, from: Date, to: Date, today: Date = startOfDay(new Date())): BinSpan {
  const tomorrow = addDays(startOfDay(today), 1);
  const first = from > start ? startOfDay(from) : start;
  const windowEnd = to < end ? startOfDay(to) : end;
  const stop = windowEnd > tomorrow ? tomorrow : windowEnd;
  const days = Math.max(0, daysBetween(first, stop)), totalDays = daysBetween(start, end);
  return {
    first, last: addDays(stop, -1), days, totalDays, full: days === totalDays,
    startsLate: first > start,
    endsEarly: windowEnd < end && windowEnd < tomorrow,
    inProgress: start < tomorrow && end > tomorrow && windowEnd >= tomorrow,
  };
}

/** h:mm:ss or m:ss. */
export function fmtDur(seconds: number | null | undefined): string {
  if (seconds == null) return '–';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "5 h 03 m" or "42 min". */
export function fmtHours(seconds: number | null | undefined): string {
  if (!seconds) return '0 h';
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  if (m === 60) return `${h + 1} h 00 m`;
  return h ? `${h} h ${pad(m)} m` : `${m} min`;
}

/** m:ss, used for paces. */
export function fmtMMSS(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const fmtInt = (n: number | null | undefined): string => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const toNumber = (v: unknown): number | null => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
