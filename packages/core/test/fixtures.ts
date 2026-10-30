import type { GarminActivity } from '../src/index.ts';

/** A run as the search endpoint returns it, trimmed to the fields Training Brief reads plus some private ones. */
export const RUN: GarminActivity = {
  activityId: 17411235803,
  activityName: 'Berlin Running',
  description: 'Felt strong, negative split.',
  startTimeLocal: '2026-10-27 06:45:12',
  startTimeGMT: '2026-10-27 05:45:12',
  activityType: { typeId: 1, typeKey: 'running', parentTypeId: 17 },
  eventType: { typeId: 4, typeKey: 'training' },
  distance: 10000,
  duration: 3100,
  movingDuration: 3000,
  elapsedDuration: 3200,
  elevationGain: 42,
  averageSpeed: 3.333,
  averageHR: 148.4,
  maxHR: 171,
  calories: 690.2,
  aerobicTrainingEffect: 3.4,
  anaerobicTrainingEffect: 1.1,
  trainingStressScore: 71.6,
  vO2MaxValue: 53,
  isFavorite: true,
  isPR: false,
  locationName: 'Berlin',
  startLatitude: 52.51,
  startLongitude: 13.4,
  ownerId: 12345,
  ownerDisplayName: 'runner-123',
  ownerFullName: 'Real Name',
  averageRunningCadenceInStepsPerMinute: 172,
};

export const RIDE: GarminActivity = {
  activityId: 17411235900,
  activityName: 'Saturday group ride',
  startTimeLocal: '2026-10-24 09:00:00',
  activityType: { typeKey: 'road_biking' },
  eventType: { typeKey: 'uncategorized' },
  distance: 80000,
  duration: 10800,
  movingDuration: 10000,
  elevationGain: 600,
  averageHR: 138,
  avgPower: 182.4,
  normPower: 199.6,
  calories: 2100,
  aerobicTrainingEffect: 3.8,
  locationName: 'Potsdam',
};

export const SWIM: GarminActivity = {
  activityId: 17411236000,
  activityName: 'Pool Swim',
  startTimeLocal: '2026-10-02 07:00:00',
  activityType: { typeKey: 'lap_swimming' },
  distance: 2000,
  duration: 2400,
  averageHR: 130,
  averageSwolf: 39,
};

/** Builds `n` minimal runs one day apart, newest last, for pagination tests. */
export function manyRuns(n: number, offset = 0): GarminActivity[] {
  return Array.from({ length: n }, (_, i) => ({
    activityId: 1000 + offset + i,
    activityName: `Run ${offset + i}`,
    startTimeLocal: '2026-01-01 08:00:00',
    activityType: { typeKey: 'running' },
    distance: 5000,
    duration: 1500,
  }));
}

/** A Response-like object for the client's fetch hook. */
export function reply(status: number, body: unknown): { status: number; ok: boolean; text: () => Promise<string> } {
  return { status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

/** An unsigned JWT with the given payload. */
export function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}
