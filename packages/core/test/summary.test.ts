import { describe, expect, it } from 'vitest';
import { filterActivities, lastDays, loadComparison, loadTrend, normalizeActivities, summaryByFamily, totals, weeklyTotals, type Activity, type GarminActivity } from '../src/index.ts';
import { RIDE, RUN, SWIM } from './fixtures.ts';

const acts = (raw: GarminActivity[]): Activity[] => normalizeActivities(raw).activities;

const session = (day: string, typeKey: string, seconds: number, extra: Partial<GarminActivity> = {}): GarminActivity => ({
  activityId: `${day}-${typeKey}`,
  startTimeLocal: `${day} 08:00:00`,
  activityType: { typeKey },
  movingDuration: seconds,
  distance: 1000,
  ...extra,
});

describe('totals', () => {
  it('sums durations, distances and weights heart rate by time', () => {
    const t = totals(acts([RUN, RIDE, SWIM]));
    expect(t.sessions).toBe(3);
    expect(t.duration).toBe(3000 + 10000 + 2400);
    expect(t.distance).toBe(92000);
    expect(t.elevation).toBe(642);
    expect(t.avgHR).toBeCloseTo((148.4 * 3000 + 138 * 10000 + 130 * 2400) / 15400, 6);
  });

  it('handles an empty list', () => {
    expect(totals([])).toEqual({ sessions: 0, duration: 0, distance: 0, elevation: 0, calories: 0, avgHR: null });
  });
});

describe('summaryByFamily', () => {
  it('groups by sport in a fixed order', () => {
    const s = summaryByFamily(acts([SWIM, RIDE, RUN, { ...RUN, activityId: 2 }]));
    expect(s.map(x => x.fam)).toEqual(['run', 'ride', 'swim']);
    expect(s[0].sessions).toBe(2);
    expect(s[0].distance).toBe(20000);
  });
});

describe('weeklyTotals', () => {
  it('starts weeks on Monday and sorts them oldest first', () => {
    const list = acts([
      session('2026-10-25', 'running', 3600), // Sunday → week of 19 Oct
      session('2026-10-26', 'running', 1800), // Monday → week of 26 Oct
      session('2026-10-19', 'road_biking', 7200, { trainingStressScore: 80 }), // Monday
      session('2026-10-28', 'lap_swimming', 1200),
    ]);
    const weeks = weeklyTotals(list);
    expect(weeks.map(w => w.week)).toEqual(['2026-10-19', '2026-10-26']);
    expect(weeks[0]).toMatchObject({ sessions: 2, duration: 10800, trainingStress: 80, durationByFamily: { run: 3600, ride: 7200 } });
    expect(weeks[1]).toMatchObject({ sessions: 2, duration: 3000, durationByFamily: { run: 1800, swim: 1200 } });
  });
});

describe('loadComparison', () => {
  it('compares the last 7 days with the average week of the last 4', () => {
    const end = new Date(2026, 9, 29);
    const list = acts([
      session('2026-10-28', 'running', 3600),
      session('2026-10-23', 'running', 3600),
      session('2026-10-10', 'running', 7200),
      session('2026-10-01', 'running', 3600),
      session('2026-09-20', 'running', 99999), // older than 28 days
      session('2026-10-29', 'running', 99999), // on the end day, excluded
    ]);
    const l = loadComparison(list, end);
    expect(l.last7Days).toBe(7200);
    expect(l.weeklyAverage4Weeks).toBe((3600 * 3 + 7200) / 4);
    expect(l.ratio).toBeCloseTo(7200 / 4500, 6);
  });

  it('returns no ratio without recent data', () => {
    expect(loadComparison([], new Date()).ratio).toBeNull();
  });

  it.each([[null, 'none'], [0.5, 'easing'], [1, 'steady'], [1.4, 'building'], [2, 'spike']] as const)('trend for %s is %s', (r, t) => expect(loadTrend(r)).toBe(t));
});

describe('filterActivities', () => {
  const list = acts([RUN, RIDE, SWIM]);

  it('filters by date range, sport and query', () => {
    expect(filterActivities(list, { families: ['run', 'swim'] }).map(a => a.fam)).toEqual(['run', 'swim']);
    expect(filterActivities(list, { from: new Date(2026, 9, 20) }).length).toBe(2);
    expect(filterActivities(list, { to: new Date(2026, 9, 20) }).map(a => a.fam)).toEqual(['swim']);
    expect(filterActivities(list, { query: 'potsdam group' }).map(a => a.fam)).toEqual(['ride']);
  });

  it('filters by distance, duration and flags', () => {
    expect(filterActivities(list, { minDistance: 5000, maxDistance: 20000 }).map(a => a.fam)).toEqual(['run']);
    expect(filterActivities(list, { minDuration: 5000 }).map(a => a.fam)).toEqual(['ride']);
    expect(filterActivities(list, { favOnly: true }).map(a => a.fam)).toEqual(['run']);
    expect(filterActivities(list, { prOnly: true })).toEqual([]);
  });

  it('builds a range that includes today', () => {
    const r = lastDays(7, new Date(2026, 9, 29, 15));
    expect(r.from).toEqual(new Date(2026, 9, 23));
    expect(r.to).toEqual(new Date(2026, 9, 30));
  });
});
