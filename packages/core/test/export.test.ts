import { describe, expect, it } from 'vitest';
import {
  AI_ATTRIBUTION_REQUEST, buildExport, COACH_PROMPT, DEFAULT_SECTIONS, estimateTokens, makeSampleActivities, normalizeActivities, sizeVerdict,
  type ExportOptions,
} from '../src/index.ts';
import { RIDE, RUN, SWIM } from './fixtures.ts';

const NOW = new Date(2026, 9, 29, 12, 0);
const list = normalizeActivities([RUN, RIDE, SWIM]).activities;

const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({
  format: 'md', detail: 'core', sections: { ...DEFAULT_SECTIONS }, privacy: true, instructions: COACH_PROMPT,
  units: 'metric', source: 'garmin', now: NOW, period: { from: new Date(2026, 9, 1), to: new Date(2026, 9, 30) }, ...o,
});

const SECRET_KEY = 'pk_live_SECRET123';

describe('markdown export', () => {
  const md = buildExport(list, opts()).text;

  it('has every section in order', () => {
    const order = ['## Instructions for the assistant', '## About this data', '## Summary by sport', '## Weekly totals', '## Activities (oldest first)'].map(h => md.indexOf(h));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('carries the Garmin attribution with each data section and in the instructions', () => {
    expect(md.match(/Data source: Garmin\./g)).toHaveLength(3);
    expect(md).toContain('**Data source:** Garmin (activities from the Garmin Connect™ Personal API)');
    expect(md).toContain('derived in part from Garmin device-sourced data');
    expect(md).toContain(COACH_PROMPT);
    expect(md).not.toMatch(/\bGC\b/);
  });

  it('states period, units, training-effect scale and the weekly note', () => {
    expect(md).toContain('**Period:** 2026-10-01 to 2026-10-29');
    expect(md).toContain('distance km; elevation m');
    expect(md).toContain("**Training effect:** Garmin's 0–5 scale");
    expect(md).toContain('Weeks start on Monday. The first and last week may be partial');
  });

  it('lists activities oldest first with core fields', () => {
    const rows = md.split('## Activities (oldest first)')[1].split('\n').filter(l => l.startsWith('| 2026'));
    expect(rows.map(r => r.slice(2, 12))).toEqual(['2026-10-02', '2026-10-24', '2026-10-27']);
    expect(md).toContain('| date | sport | type | name | distance_km | moving_time |');
    expect(md).toContain('pace_per_km');
    expect(md).toContain('5:00'); // 10 km in 50 min
    expect(md).toContain('speed_kmh');
    expect(md).toContain('swim_pace_per_100m');
  });

  it('compares the last 7 days with the 4-week average in the summary', () => {
    expect(md).toMatch(/- Load: .* in the last 7 days vs\. .* in an average week of the last 4 weeks \(ratio [\d.]+\)/);
    expect(md).toContain('last_7_days | avg_week_last_4_weeks');
  });

  it('leaves out sections that are switched off but keeps the attribution request', () => {
    const lean = buildExport(list, opts({ sections: { instructions: false, about: false, summary: false, weekly: false, activities: true } })).text;
    expect(lean).not.toContain('## About this data');
    expect(lean).not.toContain('## Weekly totals');
    expect(lean).not.toContain(COACH_PROMPT);
    expect(lean).toContain(AI_ATTRIBUTION_REQUEST);
    expect(lean).toContain('Data source: Garmin.');
  });

  it('follows the unit setting', () => {
    const mi = buildExport(list, opts({ units: 'imperial' })).text;
    expect(mi).toContain('distance mi; elevation ft');
    expect(mi).toContain('distance_mi');
    expect(mi).toContain('pace_per_mi');
    expect(mi).toContain('6.21'); // 10 km
  });

  it('adds every field as JSON Lines in full detail, without private fields', () => {
    const full = buildExport(list, opts({ detail: 'full' })).text;
    expect(full).toContain('## All fields per activity (JSON Lines)');
    expect(full).toContain('"raw.averageRunningCadenceInStepsPerMinute":172');
    expect(full).not.toContain('startLatitude');
    expect(full).not.toContain('runner-123');
    expect(full).not.toContain('Real Name');
  });

  it('keeps private fields when privacy is off', () => {
    const full = buildExport(list, opts({ detail: 'full', privacy: false })).text;
    expect(full).toContain('"raw.startLatitude":52.51');
    expect(full).toContain('runner-123');
  });

  it('writes a single activity as a field list', () => {
    const one = buildExport(list.slice(0, 1), opts()).text;
    expect(one).toContain('# Training brief: Berlin Running');
    expect(one).toContain('## Activity\n\nData source: Garmin.');
    expect(one).toContain('- **avg_hr:** 148');
    expect(one).not.toContain('## Weekly totals');
  });
});

describe('sample data export', () => {
  const sample = normalizeActivities(makeSampleActivities(NOW)).activities.slice(0, 30);

  it.each(['md', 'json', 'csv'] as const)('never attributes sample data to Garmin (%s)', format => {
    const text = buildExport(sample, opts({ source: 'sample', format })).text;
    expect(text).not.toMatch(/Garmin device|Data source: Garmin|"attribution": "Garmin"|^Garmin,/m);
    expect(text).toContain('Sample data (made up, not from any device)');
  });
});

describe('JSON export', () => {
  const doc = JSON.parse(buildExport(list, opts({ format: 'json' })).text);

  it('has an attribution field at the top and in each section', () => {
    expect(doc.attribution).toBe('Garmin');
    expect(doc.summary.attribution).toBe('Garmin');
    expect(doc.weekly.attribution).toBe('Garmin');
    expect(doc.activities.attribution).toBe('Garmin');
    expect(doc.instructions).toContain('derived in part from Garmin device-sourced data');
  });

  it('holds about, summary, weekly and activities', () => {
    expect(doc.about.period).toBe('2026-10-01 to 2026-10-29');
    expect(doc.summary.by_sport.map((s: { sport: string }) => s.sport)).toEqual(['Running', 'Cycling', 'Swimming']);
    expect(doc.summary.last_7_days_vs_4_week_average.ratio).toBeTypeOf('number');
    expect(doc.weekly.weeks[0].week_starting).toBe('2026-09-28');
    expect(doc.activities.items).toHaveLength(3);
    expect(doc.activities.items[2]).toMatchObject({ name: 'Berlin Running', distance_km: 10, avg_hr: 148, activity_id: 17411235803 });
  });
});

describe('CSV export', () => {
  it('has a data_source column set to Garmin on every row', () => {
    const lines = buildExport(list, opts({ format: 'csv' })).text.trim().split('\n');
    expect(lines[0].startsWith('data_source,date,sport')).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines.slice(1).every(l => l.startsWith('Garmin,'))).toBe(true);
  });

  it('quotes cells with commas and quotes', () => {
    const tricky = normalizeActivities([{ ...RUN, activityName: 'Run, "fast"' }]).activities;
    expect(buildExport(tricky, opts({ format: 'csv' })).text).toContain('"Run, ""fast"""');
  });

  it('writes a header even without activities', () => {
    expect(buildExport([], opts({ format: 'csv' })).text.split('\n')[0]).toContain('data_source,date');
  });
});

describe('export safety and size', () => {
  it('never contains an API key or token passed elsewhere in the app', () => {
    for (const format of ['md', 'json', 'csv'] as const) {
      const text = buildExport(list, opts({ format, detail: 'full', privacy: false })).text;
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toMatch(/ApiKey|Bearer/);
    }
  });

  it('estimates tokens at 3.6 characters each', () => {
    expect(estimateTokens('x'.repeat(36))).toBe(10);
    const r = buildExport(list, opts());
    expect(r.tokens).toBe(Math.ceil(r.text.length / 3.6));
    expect(r.filename).toBe('training-brief-2026-10-29.md');
    expect(r.mime).toBe('text/markdown');
  });

  it.each([[1000, 'small'], [20000, 'medium'], [60000, 'large'], [150000, 'too_large']] as const)('%i tokens is %s', (tokens, level) => {
    expect(sizeVerdict(tokens).level).toBe(level);
  });
});
