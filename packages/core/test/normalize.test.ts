import { describe, expect, it } from 'vitest';
import { familyOf, makeSampleActivities, mergeRawActivities, normalizeActivities, normalizeActivity } from '../src/index.ts';
import { RIDE, RUN, SWIM } from './fixtures.ts';

describe('normalizeActivity', () => {
  it('maps the search fields to an activity', () => {
    const a = normalizeActivity(RUN)!;
    expect(a).toMatchObject({
      id: 17411235803,
      name: 'Berlin Running',
      desc: 'Felt strong, negative split.',
      location: 'Berlin',
      day: '2026-10-27',
      typeKey: 'running',
      fam: 'run',
      event: 'training',
      dist: 10000,
      dur: 3000,
      elapsed: 3200,
      elev: 42,
      avgHR: 148.4,
      maxHR: 171,
      aerTE: 3.4,
      anaTE: 1.1,
      tss: 71.6,
      vo2: 53,
      fav: true,
      pr: false,
    });
    expect(a.start).toEqual(new Date(2026, 9, 27, 6, 45, 12));
    expect(a.raw).toBe(RUN);
  });

  it('prefers moving time and falls back to timer time', () => {
    expect(normalizeActivity(RUN)!.dur).toBe(3000);
    expect(normalizeActivity(SWIM)!.dur).toBe(2400);
  });

  it('reads power fields and fills defaults', () => {
    const a = normalizeActivity({ ...RIDE, activityName: '', eventType: undefined })!;
    expect(a.power).toBe(182.4);
    expect(a.np).toBe(199.6);
    expect(a.name).toBe('Road biking');
    expect(a.event).toBe('uncategorized');
  });

  it('reads values nested in summaryDTO', () => {
    const a = normalizeActivity({ activityId: 1, summaryDTO: { startTimeLocal: '2026-03-01T10:00:00', distance: '1500', averageHR: 120 }, activityTypeDTO: { typeKey: 'open_water_swimming' } })!;
    expect(a.dist).toBe(1500);
    expect(a.avgHR).toBe(120);
    expect(a.fam).toBe('swim');
  });

  it('falls back to beginTimestamp and rejects records without a start', () => {
    expect(normalizeActivity({ beginTimestamp: Date.UTC(2026, 0, 2) })?.start.getTime()).toBe(Date.UTC(2026, 0, 2));
    expect(normalizeActivity({ activityId: 1, activityName: 'No start' })).toBeNull();
    expect(normalizeActivity({ startTimeLocal: 'yesterday' })).toBeNull();
  });

  it('ignores non-numeric values', () => {
    const a = normalizeActivity({ ...RUN, averageHR: 'n/a', calories: '', maxHR: true as unknown as number })!;
    expect(a.avgHR).toBeNull();
    expect(a.cal).toBeNull();
    expect(a.maxHR).toBeNull();
  });
});

describe('familyOf', () => {
  it.each([
    ['trail_running', 'run'], ['treadmill_running', 'run'], ['lap_swimming', 'swim'], ['road_biking', 'ride'], ['indoor_cycling', 'ride'],
    ['strength_training', 'gym'], ['yoga', 'gym'], ['hiking', 'walk'], ['walking', 'walk'], ['golf', 'other'], [undefined, 'other'],
  ])('%s → %s', (key, fam) => expect(familyOf(key)).toBe(fam));
});

describe('normalizeActivities', () => {
  it('sorts newest first and counts skipped records', () => {
    const r = normalizeActivities([SWIM, RUN, { activityId: 9 }, RIDE]);
    expect(r.activities.map(a => a.id)).toEqual([RUN.activityId, RIDE.activityId, SWIM.activityId]);
    expect(r.skipped).toBe(1);
  });

  it('normalizes every sample record', () => {
    const raw = makeSampleActivities(new Date(2026, 9, 29));
    const r = normalizeActivities(raw);
    expect(r.skipped).toBe(0);
    expect(r.activities.length).toBe(raw.length);
    expect(raw.length).toBeGreaterThan(150);
    expect(new Set(r.activities.map(a => a.fam))).toEqual(new Set(['run', 'ride', 'swim', 'gym', 'walk']));
  });

  it('makes the same sample data for the same day', () => {
    const day = new Date(2026, 9, 29);
    expect(makeSampleActivities(day)).toEqual(makeSampleActivities(day));
  });
});

describe('mergeRawActivities', () => {
  it('replaces older entries with newer ones by id', () => {
    const merged = mergeRawActivities([RUN, RIDE], [{ ...RUN, activityName: 'Renamed' }, SWIM]);
    expect(merged).toHaveLength(3);
    expect(merged.find(a => a.activityId === RUN.activityId)?.activityName).toBe('Renamed');
  });
});
