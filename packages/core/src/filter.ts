import { FAMILIES } from './sports.ts';
import { addDays, startOfDay } from './time.ts';
import type { Activity, Family } from './types.ts';

/** Criteria for selecting activities. Distances in metres, durations in seconds; `to` is exclusive. */
export interface ActivityFilter {
  from?: Date | null;
  to?: Date | null;
  families?: readonly Family[];
  event?: string;
  query?: string;
  minDistance?: number | null;
  maxDistance?: number | null;
  minDuration?: number | null;
  maxDuration?: number | null;
  prOnly?: boolean;
  favOnly?: boolean;
}

const haystacks = new WeakMap<Activity, string>();
const haystack = (a: Activity): string => {
  let h = haystacks.get(a);
  if (h == null) {
    h = `${a.name} ${a.desc} ${a.location} ${a.typeKey.replace(/_/g, ' ')} ${FAMILIES[a.fam].label} ${a.event}`.toLowerCase();
    haystacks.set(a, h);
  }
  return h;
};

export const queryWords = (q: string | undefined): string[] => (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);

export function matchesFilter(a: Activity, f: ActivityFilter, words = queryWords(f.query)): boolean {
  if (f.from && a.start < f.from) return false;
  if (f.to && a.start >= f.to) return false;
  if (f.families?.length && !f.families.includes(a.fam)) return false;
  if (f.event && a.event !== f.event) return false;
  if (f.prOnly && !a.pr) return false;
  if (f.favOnly && !a.fav) return false;
  if (f.minDistance != null && !(a.dist != null && a.dist >= f.minDistance)) return false;
  if (f.maxDistance != null && !(a.dist != null && a.dist <= f.maxDistance)) return false;
  if (f.minDuration != null && !(a.dur != null && a.dur >= f.minDuration)) return false;
  if (f.maxDuration != null && !(a.dur != null && a.dur <= f.maxDuration)) return false;
  if (words.length && !words.every(w => haystack(a).includes(w))) return false;
  return true;
}

export function filterActivities(list: readonly Activity[], f: ActivityFilter): Activity[] {
  const words = queryWords(f.query);
  return list.filter(a => matchesFilter(a, f, words));
}

export interface DateRange {
  from: Date | null;
  /** Exclusive. */
  to: Date | null;
}

/** The last `days` days including today: [today − days + 1, tomorrow). */
export function lastDays(days: number, today: Date = new Date()): DateRange {
  const t = startOfDay(today);
  return { from: addDays(t, -(days - 1)), to: addDays(t, 1) };
}
