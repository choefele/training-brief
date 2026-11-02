import { addDays, dayKey, startOfDay } from './time.ts';
import type { Activity } from './types.ts';

/** Days the fitness (CTL) and fatigue (ATL) averages span. */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

export interface LoadDay {
  /** YYYY-MM-DD, local. */
  day: string;
  /** Sum of the day's activity loads; 0 on rest days. */
  load: number;
  /** Fitness: exponentially weighted average of daily load over about 42 days, after this day. */
  ctl: number;
  /** Fatigue: the same over about 7 days. */
  atl: number;
  /** Form: ctl − atl after this day. */
  tsb: number;
}

export interface TrainingLoadOptions {
  /** Load of one activity, or null when it has none (counts as 0). Defaults to Garmin's training stress score. */
  pick?: (a: Activity) => number | null;
  /** First day of the series. Defaults to the day of the oldest activity; fitness and fatigue start at 0. */
  from?: Date;
  /** Day after the last day of the series. Defaults to the day after the newest activity. */
  to?: Date;
}

/** One entry per day, oldest first: daily load with fitness, fatigue and form after that day. */
export function trainingLoad(list: readonly Activity[], options: TrainingLoadOptions = {}): LoadDay[] {
  const pick = options.pick ?? (a => a.tss);
  const byDay = new Map<string, number>();
  let first: Date | null = null, last: Date | null = null;
  for (const a of list) {
    byDay.set(a.day, (byDay.get(a.day) ?? 0) + (pick(a) ?? 0));
    if (!first || a.start < first) first = a.start;
    if (!last || a.start > last) last = a.start;
  }
  const from = startOfDay(options.from ?? first ?? new Date());
  const to = startOfDay(options.to ?? (last ? addDays(last, 1) : from));
  const days: LoadDay[] = [];
  let ctl = 0, atl = 0;
  for (let d = from; d < to; d = addDays(d, 1)) {
    const day = dayKey(d), load = byDay.get(day) ?? 0;
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    days.push({ day, load, ctl, atl, tsb: ctl - atl });
  }
  return days;
}
