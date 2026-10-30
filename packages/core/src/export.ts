import type { DateRange } from './filter.ts';
import { FAMILIES, FAMILY_ORDER, TE_SCALE_TEXT } from './sports.ts';
import { loadComparison, summaryByFamily, totals, weeklyTotals, type LoadComparison } from './summary.ts';
import { addDays, dayKey, fmtDur, fmtHours, fmtInt, fmtTime, pad, startOfDay } from './time.ts';
import type { Activity, DataSource } from './types.ts';
import { paceOrSpeed, unitLine, unitsFor, type UnitSystem, type Units } from './units.ts';

export type ExportFormat = 'md' | 'json' | 'csv';
export type ExportDetail = 'core' | 'full';

export interface ExportSections {
  instructions: boolean;
  about: boolean;
  summary: boolean;
  weekly: boolean;
  activities: boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  detail: ExportDetail;
  sections: ExportSections;
  /** Leave out GPS coordinates and owner or profile fields. */
  privacy: boolean;
  /** Free text for the assistant; the Garmin attribution request is appended automatically. */
  instructions: string;
  units: UnitSystem;
  source: DataSource;
  /** The period that was asked for; `to` is exclusive. Defaults to the span of the activities. */
  period?: DateRange;
  /** Human-readable filters, e.g. "running only". */
  filterDescription?: string;
  /** Activities used for the last-7-days comparison: same sport filter, any date. Defaults to the exported list. */
  context?: readonly Activity[];
  now?: Date;
}

export interface ExportResult {
  text: string;
  ext: ExportFormat;
  mime: string;
  filename: string;
  chars: number;
  tokens: number;
}

/** The attribution Garmin's brand guidelines ask for. The search endpoint returns no device model, so just "Garmin". */
export const GARMIN_ATTRIBUTION = 'Garmin';
/** Covers every chart and figure in a view, placed once under its title. */
export const CHART_ATTRIBUTION = 'Charts and figures created using data provided by Garmin devices.';
export const AI_ATTRIBUTION_REQUEST =
  'When you share analysis, insights or recommendations based on this data, state that they are derived in part from Garmin device-sourced data. Do not suggest that Garmin produced or endorses them.';
export const SAMPLE_SOURCE = 'Sample data (made up, not from any device)';

export const sourceLabel = (source: DataSource): string => (source === 'garmin' ? GARMIN_ATTRIBUTION : SAMPLE_SOURCE);

export const DEFAULT_SECTIONS: ExportSections = { instructions: true, about: true, summary: true, weekly: true, activities: true };

export const COACH_PROMPT =
  'You are an experienced endurance coach. Review my training log below. Describe trends in volume, intensity and consistency, point out signs of overtraining or injury risk, and suggest how to structure the next two weeks. Ask me about my goals, upcoming races and how I feel before you make firm recommendations.';
export const RACE_PROMPT =
  'You are an experienced running coach. I am preparing for a race. Using the training log below, assess how ready I am, which sessions show my current fitness, and what the remaining weeks should focus on, including taper. Ask for the race distance, date and goal time before you make firm recommendations.';
export const ACTIVITY_PROMPT =
  'You are an experienced endurance coach. Review this single session: what it tells you about effort, pacing and fitness, and what I could do differently next time. Ask about how the session felt and what it was meant to be if that matters for your answer.';

const MIME: Record<ExportFormat, string> = { md: 'text/markdown', json: 'application/json', csv: 'text/csv' };

/** Owner, social and location fields that the privacy option strips. */
const PRIVATE_KEYS = /^(owner|activityLike|likedBy|commentedBy|requestor|userProfile|userInfo|startLatitude|startLongitude|endLatitude|endLongitude|comments|userRoles|privacy)/i;

/** Rough token count for chat models: about 3.6 characters per token for this kind of text. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.6);

export type SizeLevel = 'small' | 'medium' | 'large' | 'too_large';

export interface SizeVerdict {
  level: SizeLevel;
  message: string;
}

export function sizeVerdict(tokens: number): SizeVerdict {
  if (tokens < 8000) return { level: 'small', message: 'Fits easily in any chat.' };
  if (tokens < 30000) return { level: 'medium', message: 'Fits most chats.' };
  if (tokens < 100000) return { level: 'large', message: 'Long. Some chats, especially free plans, may cut it off. A shorter period or core fields help.' };
  return { level: 'too_large', message: 'Probably too large to paste. Save it as a file and upload it, or choose a shorter period.' };
}

interface Columns {
  dist: string;
  elev: string;
  pace: string;
  swimPace: string;
  speed: string;
}

const columnsFor = (u: Units): Columns =>
  u.system === 'metric'
    ? { dist: 'distance_km', elev: 'elevation_gain_m', pace: 'pace_per_km', swimPace: 'swim_pace_per_100m', speed: 'speed_kmh' }
    : { dist: 'distance_mi', elev: 'elevation_gain_ft', pace: 'pace_per_mi', swimPace: 'swim_pace_per_100yd', speed: 'speed_mph' };

type Row = Record<string, string | number | boolean | null>;

const dropEmpty = (r: Row): Row => {
  for (const k of Object.keys(r)) if (r[k] == null || r[k] === '') delete r[k];
  return r;
};

/** About 20 fields that cover most coaching questions. */
export function coreRecord(a: Activity, u: Units): Row {
  const c = columnsFor(u);
  const speedKey = a.fam === 'run' || a.fam === 'walk' ? c.pace : a.fam === 'swim' ? c.swimPace : c.speed;
  return dropEmpty({
    date: `${a.day} ${fmtTime(a.start)}`,
    sport: FAMILIES[a.fam].label,
    type: a.typeKey,
    name: a.name,
    [c.dist]: a.dist ? +(a.dist / u.dist).toFixed(2) : null,
    moving_time: a.dur ? fmtDur(a.dur) : null,
    [speedKey]: a.dist && a.dur ? paceOrSpeed(a, u, false) : null,
    [c.elev]: a.elev != null ? Math.round(a.elev / u.elev) : null,
    avg_hr: a.avgHR != null ? Math.round(a.avgHR) : null,
    max_hr: a.maxHR != null ? Math.round(a.maxHR) : null,
    aerobic_te: a.aerTE,
    anaerobic_te: a.anaTE,
    training_stress: a.tss != null ? Math.round(a.tss) : null,
    avg_power_w: a.power != null ? Math.round(a.power) : null,
    norm_power_w: a.np != null ? Math.round(a.np) : null,
    vo2max: a.vo2,
    calories: a.cal != null ? Math.round(a.cal) : null,
    event: a.event === 'uncategorized' ? null : a.event,
    personal_record: a.pr || null,
    notes: a.desc || null,
    location: a.location || null,
    activity_id: a.id,
  });
}

/** Core fields plus every scalar the API returned, prefixed "raw.". */
export function fullRecord(a: Activity, u: Units, privacy: boolean): Row {
  const out = coreRecord(a, u);
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === '' || (privacy && PRIVATE_KEYS.test(k))) continue;
      if (Array.isArray(v)) {
        if (v.length && v.every(x => typeof x !== 'object')) out[`raw.${prefix}${k}`] = v.join('|');
        continue;
      }
      if (typeof v === 'object') {
        if (k === 'activityType' || k === 'eventType' || k === 'summaryDTO') walk(v as Record<string, unknown>, `${prefix}${k}.`);
        continue;
      }
      out[`raw.${prefix}${k}`] = v as string | number | boolean;
    }
  };
  walk(a.raw, '');
  return out;
}

interface Prepared {
  list: Activity[];
  u: Units;
  c: Columns;
  source: string;
  now: Date;
  period: { from: string; to: string } | null;
  load: LoadComparison;
  loadByFamily: Map<string, LoadComparison>;
}

function prepare(activities: readonly Activity[], o: ExportOptions): Prepared {
  const list = [...activities].sort((a, b) => +a.start - +b.start);
  const u = unitsFor(o.units);
  const now = o.now ?? new Date();
  const from = o.period?.from ?? (list.length ? startOfDay(list[0].start) : null);
  const toExclusive = o.period?.to ?? (list.length ? addDays(startOfDay(list[list.length - 1].start), 1) : null);
  const period = from && toExclusive ? { from: dayKey(from), to: dayKey(addDays(toExclusive, -1)) } : null;
  const loadEnd = toExclusive && toExclusive < addDays(startOfDay(now), 1) ? toExclusive : addDays(startOfDay(now), 1);
  const pool = o.context ?? list;
  const loadByFamily = new Map<string, LoadComparison>();
  for (const f of FAMILY_ORDER) loadByFamily.set(f, loadComparison(pool.filter(a => a.fam === f), loadEnd));
  return { list, u, c: columnsFor(u), source: sourceLabel(o.source), now, period, load: loadComparison(pool, loadEnd), loadByFamily };
}

function instructionsText(o: ExportOptions): string | null {
  const parts: string[] = [];
  if (o.sections.instructions && o.instructions.trim()) parts.push(o.instructions.trim());
  if (o.source === 'garmin') parts.push(AI_ATTRIBUTION_REQUEST);
  else if (parts.length) parts.push('Note: this is made-up sample data for trying the tool, not real training.');
  return parts.length ? parts.join('\n\n') : null;
}

function aboutRows(p: Prepared, o: ExportOptions): [string, string][] {
  const stamp = `${dayKey(p.now)} ${pad(p.now.getHours())}:${pad(p.now.getMinutes())}`;
  const rows: [string, string][] = [
    ['Data source', o.source === 'garmin' ? `${GARMIN_ATTRIBUTION} (activities from the Garmin Connect™ Personal API)` : SAMPLE_SOURCE],
    ['Generated', stamp],
  ];
  if (p.period) rows.push(['Period', `${p.period.from} to ${p.period.to}`]);
  rows.push(['Activities', String(p.list.length)]);
  if (o.filterDescription) rows.push(['Filters', o.filterDescription]);
  rows.push(['Units', unitLine(p.u)]);
  rows.push(['Training effect', TE_SCALE_TEXT]);
  if (o.detail === 'full') rows.push(['Raw fields', 'Fields prefixed "raw." are passed through from the API in its own units: metres, seconds, m/s.']);
  if (o.privacy) rows.push(['Privacy', 'GPS coordinates and owner or profile fields are left out.']);
  return rows;
}

function summaryRows(p: Prepared): Row[] {
  return summaryByFamily(p.list).map(s => {
    const load = p.loadByFamily.get(s.fam)!;
    return {
      sport: FAMILIES[s.fam].label,
      sessions: s.sessions,
      moving_time: fmtHours(s.duration),
      [p.c.dist]: +(s.distance / p.u.dist).toFixed(1),
      [p.c.elev]: Math.round(s.elevation / p.u.elev),
      avg_hr: s.avgHR ? Math.round(s.avgHR) : null,
      last_7_days: fmtHours(load.last7Days),
      avg_week_last_4_weeks: fmtHours(load.weeklyAverage4Weeks),
    };
  });
}

function weeklyRows(p: Prepared): Row[] {
  const weeks = weeklyTotals(p.list);
  const fams = FAMILY_ORDER.filter(f => weeks.some(w => w.durationByFamily[f]));
  return weeks.map(w => ({
    week_starting: w.week,
    sessions: w.sessions,
    moving_time: fmtHours(w.duration),
    [p.c.dist]: +(w.distance / p.u.dist).toFixed(1),
    [p.c.elev]: Math.round(w.elevation / p.u.elev),
    training_stress: w.trainingStress ? Math.round(w.trainingStress) : null,
    ...Object.fromEntries(fams.map(f => [`${f}_time`, w.durationByFamily[f] ? fmtHours(w.durationByFamily[f]) : null])),
  }));
}

const WEEKLY_NOTE = 'Weeks start on Monday. The first and last week may be partial because the period cuts them off.';

function totalsLine(p: Prepared): string {
  const t = totals(p.list);
  return `${t.sessions} sessions, ${fmtHours(t.duration)} moving, ${fmtInt(t.distance / p.u.dist)} ${p.u.distL}, ${fmtInt(t.elevation / p.u.elev)} ${p.u.elevL} climbing`;
}

function loadLine(p: Prepared): string | null {
  const l = p.load;
  if (l.ratio == null) return null;
  return `${fmtHours(l.last7Days)} in the last 7 days vs. ${fmtHours(l.weeklyAverage4Weeks)} in an average week of the last 4 weeks (ratio ${l.ratio.toFixed(2)})`;
}

const mdCell = (v: unknown): string => (v == null ? '' : String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '));

function mdTable(rows: Row[]): string {
  if (!rows.length) return '_None._\n';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n` + rows.map(r => `| ${cols.map(c => mdCell(r[c])).join(' | ')} |`).join('\n') + '\n';
}

const sourceNote = (p: Prepared): string => `Data source: ${p.source}.`;

function buildMarkdown(p: Prepared, o: ExportOptions): string {
  const one = p.list.length === 1;
  let md = one ? `# Training brief: ${p.list[0].name}\n\n` : '# Training brief\n\n';
  const instructions = instructionsText(o);
  if (instructions) md += `## Instructions for the assistant\n\n${instructions}\n\n`;
  if (o.sections.about) md += '## About this data\n\n' + aboutRows(p, o).map(([k, v]) => `- **${k}:** ${v}`).join('\n') + '\n\n';
  if (o.sections.summary && !one) {
    md += `## Summary by sport\n\n${sourceNote(p)}\n\n- Total: ${totalsLine(p)}\n`;
    const load = loadLine(p);
    if (load) md += `- Load: ${load}\n`;
    md += '\n' + mdTable(summaryRows(p)) + '\n';
  }
  if (o.sections.weekly && !one) md += `## Weekly totals\n\n${sourceNote(p)} ${WEEKLY_NOTE}\n\n` + mdTable(weeklyRows(p)) + '\n';
  if (o.sections.activities) {
    if (one) {
      const rec = o.detail === 'full' ? fullRecord(p.list[0], p.u, o.privacy) : coreRecord(p.list[0], p.u);
      md += `## Activity\n\n${sourceNote(p)}\n\n` + Object.entries(rec).map(([k, v]) => `- **${k}:** ${mdCell(v)}`).join('\n') + '\n';
    } else {
      md += `## Activities (oldest first)\n\n${sourceNote(p)}\n\n` + mdTable(p.list.map(a => coreRecord(a, p.u)));
      if (o.detail === 'full') {
        const lines = p.list.map(a => JSON.stringify(fullRecord(a, p.u, o.privacy)));
        md += `\n## All fields per activity (JSON Lines)\n\n${sourceNote(p)}\n\n\`\`\`jsonl\n${lines.join('\n')}\n\`\`\`\n`;
      }
    }
  }
  return md;
}

function buildJson(p: Prepared, o: ExportOptions): string {
  const attribution = p.source;
  const doc: Record<string, unknown> = { attribution };
  const instructions = instructionsText(o);
  if (instructions) doc.instructions = instructions;
  if (o.sections.about) doc.about = Object.fromEntries(aboutRows(p, o).map(([k, v]) => [k.toLowerCase().replace(/ /g, '_'), v]));
  if (o.sections.summary) {
    const t = totals(p.list);
    doc.summary = {
      attribution,
      totals: { sessions: t.sessions, moving_time: fmtHours(t.duration), [p.c.dist]: +(t.distance / p.u.dist).toFixed(1), [p.c.elev]: Math.round(t.elevation / p.u.elev) },
      last_7_days_vs_4_week_average: p.load.ratio == null ? null : { last_7_days: fmtHours(p.load.last7Days), avg_week_last_4_weeks: fmtHours(p.load.weeklyAverage4Weeks), ratio: +p.load.ratio.toFixed(2) },
      by_sport: summaryRows(p).map(dropEmpty),
    };
  }
  if (o.sections.weekly) doc.weekly = { attribution, note: WEEKLY_NOTE, weeks: weeklyRows(p).map(dropEmpty) };
  if (o.sections.activities) {
    doc.activities = { attribution, items: p.list.map(a => (o.detail === 'full' ? fullRecord(a, p.u, o.privacy) : coreRecord(a, p.u))) };
  }
  return JSON.stringify(doc, null, 1);
}

const csvCell = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per activity; sections other than the activity list don't fit a CSV. */
function buildCsv(p: Prepared, o: ExportOptions): string {
  const recs = p.list.map(a => ({ data_source: p.source, ...(o.detail === 'full' ? fullRecord(a, p.u, o.privacy) : coreRecord(a, p.u)) }));
  const cols = recs.length ? [...new Set(recs.flatMap(r => Object.keys(r)))] : ['data_source', ...Object.keys(coreRecord(SAMPLE_ROW_SHAPE, p.u))];
  return [cols.join(','), ...recs.map(r => cols.map(c => csvCell((r as Row)[c])).join(','))].join('\n') + '\n';
}

// Gives an empty CSV the usual header row.
const SAMPLE_ROW_SHAPE: Activity = {
  id: 0, name: '-', desc: '', location: '', start: new Date(2000, 0, 1), day: '2000-01-01', typeKey: 'running', fam: 'run', event: 'uncategorized',
  dist: 1, dur: 1, elapsed: 1, elev: 1, avgHR: 1, maxHR: 1, cal: 1, aerTE: 1, anaTE: 1, tss: 1, vo2: 1, power: 1, np: 1, fav: false, pr: false, raw: {},
};

/** Builds the export text. Never includes API keys or tokens: it only sees activities. */
export function buildExport(activities: readonly Activity[], o: ExportOptions): ExportResult {
  const p = prepare(activities, o);
  const text = o.format === 'json' ? buildJson(p, o) : o.format === 'csv' ? buildCsv(p, o) : buildMarkdown(p, o);
  return { text, ext: o.format, mime: MIME[o.format], filename: `training-brief-${dayKey(p.now)}.${o.format}`, chars: text.length, tokens: estimateTokens(text) };
}
