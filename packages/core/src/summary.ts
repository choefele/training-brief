import { FAMILY_ORDER } from './sports.ts';
import { addDays, dayKey, monday } from './time.ts';
import type { Activity, Family } from './types.ts';

/** Totals in base units: seconds and metres. */
export interface Totals {
  sessions: number;
  duration: number;
  distance: number;
  elevation: number;
  calories: number;
  /** Heart rate averaged over sessions, weighted by moving time. */
  avgHR: number | null;
}

const sumOf = (list: readonly Activity[], pick: (a: Activity) => number | null): number => list.reduce((s, a) => s + (pick(a) ?? 0), 0);

export function weightedHR(list: readonly Activity[]): number | null {
  let weighted = 0, time = 0;
  for (const a of list) {
    if (a.avgHR && a.dur) {
      weighted += a.avgHR * a.dur;
      time += a.dur;
    }
  }
  return time ? weighted / time : null;
}

export function totals(list: readonly Activity[]): Totals {
  return {
    sessions: list.length,
    duration: sumOf(list, a => a.dur),
    distance: sumOf(list, a => a.dist),
    elevation: sumOf(list, a => a.elev),
    calories: sumOf(list, a => a.cal),
    avgHR: weightedHR(list),
  };
}

export interface FamilySummary extends Totals {
  fam: Family;
}

/** Totals per sport, in the fixed sport order. */
export function summaryByFamily(list: readonly Activity[]): FamilySummary[] {
  const groups = new Map<Family, Activity[]>();
  for (const a of list) groups.set(a.fam, [...(groups.get(a.fam) ?? []), a]);
  return FAMILY_ORDER.filter(f => groups.has(f)).map(f => ({ fam: f, ...totals(groups.get(f)!) }));
}

export interface WeekTotal {
  /** YYYY-MM-DD of the Monday that starts the week. */
  week: string;
  sessions: number;
  duration: number;
  distance: number;
  elevation: number;
  trainingStress: number;
  /** Moving time per sport. */
  durationByFamily: Partial<Record<Family, number>>;
}

/** Weekly totals, Monday to Sunday, oldest first. Only weeks with activities appear. */
export function weeklyTotals(list: readonly Activity[]): WeekTotal[] {
  const weeks = new Map<string, WeekTotal>();
  for (const a of list) {
    const key = dayKey(monday(a.start));
    const w = weeks.get(key) ?? { week: key, sessions: 0, duration: 0, distance: 0, elevation: 0, trainingStress: 0, durationByFamily: {} };
    w.sessions++;
    w.duration += a.dur ?? 0;
    w.distance += a.dist ?? 0;
    w.elevation += a.elev ?? 0;
    w.trainingStress += a.tss ?? 0;
    w.durationByFamily[a.fam] = (w.durationByFamily[a.fam] ?? 0) + (a.dur ?? 0);
    weeks.set(key, w);
  }
  return [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

export interface LoadComparison {
  /** Moving time in the 7 days before `end`, seconds. */
  last7Days: number;
  /** Average weekly moving time over the 28 days before `end`, seconds. */
  weeklyAverage4Weeks: number;
  /** last7Days ÷ weeklyAverage4Weeks, or null without recent data. */
  ratio: number | null;
}

/** Compares the last 7 days with the average week of the last 4 weeks, both ending at `end` (exclusive). */
export function loadComparison(pool: readonly Activity[], end: Date): LoadComparison {
  const from28 = addDays(end, -28), from7 = addDays(end, -7);
  let last7Days = 0, last28Days = 0;
  for (const a of pool) {
    if (a.start < from28 || a.start >= end) continue;
    last28Days += a.dur ?? 0;
    if (a.start >= from7) last7Days += a.dur ?? 0;
  }
  const weeklyAverage4Weeks = last28Days / 4;
  return { last7Days, weeklyAverage4Weeks, ratio: weeklyAverage4Weeks ? last7Days / weeklyAverage4Weeks : null };
}

export type LoadTrend = 'none' | 'easing' | 'steady' | 'building' | 'spike';

export function loadTrend(ratio: number | null): LoadTrend {
  if (ratio == null) return 'none';
  if (ratio < 0.8) return 'easing';
  if (ratio <= 1.3) return 'steady';
  if (ratio <= 1.5) return 'building';
  return 'spike';
}
