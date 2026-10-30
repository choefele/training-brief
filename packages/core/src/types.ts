/** One entry of the array returned by activitylist-service/activities/search/activities (SummarizedActivityDTO). */
export interface GarminActivity {
  activityId?: number | string;
  activityName?: string;
  description?: string | null;
  startTimeLocal?: string;
  startTimeGMT?: string;
  beginTimestamp?: number;
  activityType?: { typeId?: number; typeKey?: string; parentTypeId?: number };
  eventType?: { typeId?: number; typeKey?: string };
  distance?: number | null;
  duration?: number | null;
  movingDuration?: number | null;
  elapsedDuration?: number | null;
  elevationGain?: number | null;
  averageSpeed?: number | null;
  averageHR?: number | null;
  maxHR?: number | null;
  calories?: number | null;
  aerobicTrainingEffect?: number | null;
  anaerobicTrainingEffect?: number | null;
  trainingStressScore?: number | null;
  vO2MaxValue?: number | null;
  avgPower?: number | null;
  normPower?: number | null;
  isFavorite?: boolean;
  isPR?: boolean;
  locationName?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  [field: string]: unknown;
}

export type Family = 'run' | 'ride' | 'swim' | 'gym' | 'walk' | 'other';

/** A Garmin activity normalized for display and export. Distances in metres, durations in seconds. */
export interface Activity {
  id: number | string | null;
  name: string;
  desc: string;
  location: string;
  start: Date;
  /** YYYY-MM-DD, local. */
  day: string;
  typeKey: string;
  fam: Family;
  event: string;
  dist: number | null;
  /** Moving time, falling back to timer time. */
  dur: number | null;
  elapsed: number | null;
  elev: number | null;
  avgHR: number | null;
  maxHR: number | null;
  cal: number | null;
  aerTE: number | null;
  anaTE: number | null;
  tss: number | null;
  vo2: number | null;
  power: number | null;
  np: number | null;
  fav: boolean;
  pr: boolean;
  raw: GarminActivity;
}

/** Where a set of activities came from. Only real Garmin data carries a Garmin attribution. */
export type DataSource = 'garmin' | 'sample';
