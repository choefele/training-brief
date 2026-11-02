import { describe, expect, it } from 'vitest';
import { normalizeActivities, parseDay, trainingLoad, type Activity, type GarminActivity } from '../src/index.ts';

const acts = (raw: GarminActivity[]): Activity[] => normalizeActivities(raw).activities;

const session = (day: string, tss: number | null, typeKey = 'running'): GarminActivity => ({
  activityId: `${day}-${typeKey}`,
  startTimeLocal: `${day} 08:00:00`,
  activityType: { typeKey },
  movingDuration: 3600,
  trainingStressScore: tss,
});

describe('trainingLoad', () => {
  it('starts at zero and moves fitness by a 42nd and fatigue by a 7th of the difference', () => {
    const [d1, d2] = trainingLoad(acts([session('2026-10-01', 42)]), { to: parseDay('2026-10-03')! });
    expect(d1).toEqual({ day: '2026-10-01', load: 42, ctl: 1, atl: 6, tsb: -5 });
    expect(d2.day).toBe('2026-10-02');
    expect(d2.load).toBe(0);
    expect(d2.ctl).toBeCloseTo(41 / 42, 10);
    expect(d2.atl).toBeCloseTo(36 / 7, 10);
    expect(d2.tsb).toBeCloseTo(41 / 42 - 36 / 7, 10);
  });

  it('sums sessions on the same day and counts sessions without a load as zero', () => {
    const days = trainingLoad(acts([session('2026-10-01', 30), session('2026-10-01', 12, 'road_biking'), session('2026-10-01', null, 'strength_training')]));
    expect(days).toHaveLength(1);
    expect(days[0].load).toBe(42);
  });

  it('fills rest days between sessions and converges to a steady load', () => {
    const raw = Array.from({ length: 400 }, (_, i) => session(new Date(2025, 0, 1 + i).toLocaleDateString('sv-SE'), 100));
    const days = trainingLoad(acts(raw));
    expect(days).toHaveLength(400);
    expect(days[399].ctl).toBeCloseTo(100, 0);
    expect(days[399].tsb).toBeCloseTo(0, 0);
  });

  it('uses another load source when asked', () => {
    const [d] = trainingLoad(acts([{ ...session('2026-10-01', 50), activityTrainingLoad: 84 }]), { pick: a => Number(a.raw.activityTrainingLoad) });
    expect(d.load).toBe(84);
  });

  it('returns nothing without activities or days', () => {
    expect(trainingLoad([])).toEqual([]);
  });
});
