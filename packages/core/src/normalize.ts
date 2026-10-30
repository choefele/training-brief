import { familyOf, typeLabel } from './sports.ts';
import { dayKey, parseLocal, toNumber } from './time.ts';
import type { Activity, GarminActivity } from './types.ts';

/** Turns one SummarizedActivityDTO into an Activity, or null when it has no usable start time. */
export function normalizeActivity(a: GarminActivity): Activity | null {
  if (!a || typeof a !== 'object') return null;
  const summary = (a.summaryDTO && typeof a.summaryDTO === 'object' ? a.summaryDTO : {}) as Record<string, unknown>;
  const type = (a.activityType ?? a.activityTypeDTO ?? {}) as { typeKey?: string };
  const event = (a.eventType ?? a.eventTypeDTO ?? {}) as { typeKey?: string };
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = toNumber(a[k] ?? summary[k]);
      if (v != null) return v;
    }
    return null;
  };
  const startText = (a.startTimeLocal ?? summary.startTimeLocal) as string | undefined;
  const start = parseLocal(startText) ?? (typeof a.beginTimestamp === 'number' ? new Date(a.beginTimestamp) : null);
  if (!start || Number.isNaN(+start)) return null;
  const typeKey = type.typeKey || 'other';
  return {
    id: a.activityId ?? null,
    name: a.activityName || typeLabel(typeKey),
    desc: a.description || '',
    location: a.locationName || '',
    start,
    day: dayKey(start),
    typeKey,
    fam: familyOf(typeKey),
    event: event.typeKey || 'uncategorized',
    dist: pick('distance'),
    dur: pick('movingDuration', 'duration'),
    elapsed: pick('elapsedDuration', 'duration'),
    elev: pick('elevationGain'),
    avgHR: pick('averageHR'),
    maxHR: pick('maxHR'),
    cal: pick('calories'),
    aerTE: pick('aerobicTrainingEffect', 'trainingEffect'),
    anaTE: pick('anaerobicTrainingEffect'),
    tss: pick('trainingStressScore'),
    vo2: pick('vO2MaxValue'),
    power: pick('avgPower', 'averagePower'),
    np: pick('normPower', 'normalizedPower'),
    fav: !!a.isFavorite,
    pr: !!(a.isPR || a.personalRecord),
    raw: a,
  };
}

export interface NormalizeResult {
  /** Newest first. */
  activities: Activity[];
  /** Records without a usable start time. */
  skipped: number;
}

export function normalizeActivities(raw: readonly GarminActivity[]): NormalizeResult {
  const activities: Activity[] = [];
  let skipped = 0;
  for (const r of raw) {
    const a = normalizeActivity(r);
    if (a) activities.push(a);
    else skipped++;
  }
  activities.sort((x, y) => +y.start - +x.start);
  return { activities, skipped };
}

/** Merges two raw lists by activityId; entries in `newer` replace those in `older`. */
export function mergeRawActivities(older: readonly GarminActivity[], newer: readonly GarminActivity[]): GarminActivity[] {
  const byId = new Map<string, GarminActivity>();
  const anonymous: GarminActivity[] = [];
  for (const a of [...older, ...newer]) {
    if (a.activityId == null) anonymous.push(a);
    else byId.set(String(a.activityId), a);
  }
  return [...byId.values(), ...anonymous];
}
