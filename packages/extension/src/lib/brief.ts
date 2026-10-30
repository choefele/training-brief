import { buildExport, type Activity, type DataSource, type DateRange, type ExportResult } from '@training-brief/core';
import type { Settings } from './storage.ts';

export interface BriefInput {
  activities: readonly Activity[];
  source: DataSource;
  settings: Settings;
  period?: DateRange;
  filterDescription?: string;
  context?: readonly Activity[];
}

/** Builds the export with the user's saved export settings. */
export function buildBrief(input: BriefInput): ExportResult {
  const { settings: s } = input;
  return buildExport(input.activities, {
    ...s.export,
    units: s.units,
    source: input.source,
    period: input.period,
    filterDescription: input.filterDescription,
    context: input.context,
  });
}
