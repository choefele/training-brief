import { makeSampleActivities, normalizeActivities, parseDay, type Activity, type DataSource } from '@training-brief/core';
import { getData } from './storage.ts';

export interface Dataset {
  /** Newest first. */
  activities: Activity[];
  source: DataSource;
  loadedAt: number | null;
  /** The earliest day the loaded Garmin data is complete for. */
  coveredFrom: Date | null;
}

/** The loaded Garmin activities, or clearly labeled sample data until there are some. */
export async function loadDataset(): Promise<Dataset> {
  const stored = await getData();
  if (stored?.raw.length) {
    return { activities: normalizeActivities(stored.raw).activities, source: 'garmin', loadedAt: stored.loadedAt, coveredFrom: parseDay(stored.coveredFrom) };
  }
  return { activities: normalizeActivities(makeSampleActivities()).activities, source: 'sample', loadedAt: null, coveredFrom: null };
}
