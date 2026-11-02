import {
  addDays, binSpan, CHART_ATTRIBUTION, dayKey, FAMILIES, FAMILY_ORDER, fmtDate, fmtDistance, fmtDur, fmtElevation, fmtHours, fmtInt, fmtMMSS, fmtShort, fmtSpan,
  fmtTime, isFamily, loadComparison, loadTrend, matchesFilter, median, monday, MONTHS, pad, paceOrSpeed, parseDay, queryWords, sizeVerdict,
  startOfDay, TE_BANDS, teLabel, typeLabel, unitsFor, usesPace, weekdayIndex, WEEKDAYS, weightedHR,
  type Activity, type ActivityFilter, type BinSpan, type DateRange, type ExportFormat, type ExportResult, type ExportSections, type Family, type Units,
} from '@training-brief/core';
import { buildBrief } from '../lib/brief.ts';
import { loadDataset, type Dataset } from '../lib/dataset.ts';
import { connectionStatus, describeError, loadFromGarmin, type ConnectionStatus } from '../lib/garmin.ts';
import { openSettings } from '../lib/nav.ts';
import { getSettings, onStorageChange, updateSettings, type Settings } from '../lib/storage.ts';
import { $, $$, copyText, downloadExport, esc, fmtSize, fmtTokens, fmtWhen, setStatus } from '../lib/ui.ts';

/* ---------- State ---------- */

type View = 'dashboard' | 'activities' | 'export';
type VolMetric = 'time' | 'dist' | 'elev' | 'count';
type TrendMetric = 'pace' | 'hr' | 'eff';

interface Filters {
  q: string;
  range: string;
  from: string;
  to: string;
  fams: Set<Family>;
  event: string;
  minDist: string;
  maxDist: string;
  minDur: string;
  maxDur: string;
  pr: boolean;
  fav: boolean;
}

const freshFilters = (): Filters => ({ q: '', range: '90', from: '', to: '', fams: new Set(), event: '', minDist: '', maxDist: '', minDur: '', maxDur: '', pr: false, fav: false });

const S = {
  f: freshFilters(),
  view: 'dashboard' as View,
  vol: 'time' as VolMetric,
  trend: 'pace' as TrendMetric,
  sort: { key: 'date', dir: -1 },
  shown: 60,
};
let data: Dataset = { activities: [], source: 'sample', loadedAt: null, coveredFrom: null };
let settings: Settings;
let connection: ConnectionStatus = { connected: false, hasKey: false, rejected: false, token: null };
let U: Units = unitsFor('metric');
let filtered: Activity[] = [];
let loading = false;
const isLive = (): boolean => data.source === 'garmin';

/* ---------- Filtering ---------- */

function rangeBounds(): [Date | null, Date | null] {
  const today = startOfDay(new Date()), f = S.f;
  if (f.range === 'all') return [null, null];
  if (f.range === 'ytd') return [new Date(today.getFullYear(), 0, 1), null];
  if (f.range === 'custom') return [parseDay(f.from), f.to ? addDays(parseDay(f.to)!, 1) : null];
  return [addDays(today, -(Number(f.range) - 1)), null];
}

const numOrNull = (v: string, factor: number): number | null => (v === '' || Number.isNaN(Number(v)) ? null : Number(v) * factor);

/** Every filter except the dates. */
function baseFilter(): ActivityFilter {
  const f = S.f;
  return {
    families: [...f.fams], event: f.event, query: f.q, prOnly: f.pr, favOnly: f.fav,
    minDistance: numOrNull(f.minDist, U.dist), maxDistance: numOrNull(f.maxDist, U.dist),
    minDuration: numOrNull(f.minDur, 60), maxDuration: numOrNull(f.maxDur, 60),
  };
}

function applyFilters(): void {
  const [from, to] = rangeBounds();
  const filter = { ...baseFilter(), from, to }, words = queryWords(filter.query);
  filtered = data.activities.filter(a => matchesFilter(a, filter, words));
}

/** The span the charts cover: the selected range, or the data's own extent for "All loaded". */
function chartWindow(): [Date, Date] {
  let [from, to] = rangeBounds();
  const today = startOfDay(new Date());
  if (!to) to = addDays(today, 1);
  if (!from) from = filtered.length ? startOfDay(filtered[filtered.length - 1].start) : addDays(today, -90);
  return [from, to];
}

/** Activities matching every filter except the dates, inside [from, to). */
function inWindow(from: Date, to: Date): Activity[] {
  const filter = { ...baseFilter(), from, to }, words = queryWords(filter.query);
  return data.activities.filter(a => matchesFilter(a, filter, words));
}

function describeFilters(): string {
  const f = S.f, parts: string[] = [];
  const r = $<HTMLSelectElement>('#range');
  parts.push(f.range === 'custom' ? `dates ${f.from || 'start'} to ${f.to || 'today'}` : (r.selectedOptions[0]?.text ?? '').toLowerCase());
  if (f.fams.size) parts.push('sports: ' + [...f.fams].map(k => FAMILIES[k].label).join(', '));
  if (f.q) parts.push(`search "${f.q}"`);
  if (f.event) parts.push('event: ' + f.event);
  if (f.minDist !== '' || f.maxDist !== '') parts.push(`distance ${f.minDist || 0}–${f.maxDist || '∞'} ${U.distL}`);
  if (f.minDur !== '' || f.maxDur !== '') parts.push(`moving time ${f.minDur || 0}–${f.maxDur || '∞'} min`);
  if (f.pr) parts.push('personal records only');
  if (f.fav) parts.push('favorites only');
  return parts.join('; ');
}

/* ---------- Header, attribution and filter UI ---------- */

function renderHeader(): void {
  $('#attribution').innerHTML = isLive()
    ? `<i class="dot live"></i><span>Data: <b>Garmin</b> · ${data.activities.length} activities · loaded ${esc(fmtWhen(data.loadedAt ?? Date.now()))}</span>`
    : '<i class="dot sample"></i><span><b>Sample data</b> · made up, not from any device</span>';
  // Sits in the subtitle right under the title, where Garmin's guidelines want it; sample data gets none.
  $('#chartAttribution').textContent = isLive() ? ` ${CHART_ATTRIBUTION}` : '';
  $('#tableAttribution').innerHTML = isLive() ? 'Activities from <b>Garmin</b>' : '<b>Sample data</b>, made up for illustration';

  const loadBtn = $<HTMLButtonElement>('#loadBtn');
  loadBtn.hidden = !connection.connected;
  loadBtn.disabled = loading;
  if (!loading) loadBtn.textContent = isLive() ? 'Refresh from Garmin' : 'Load from Garmin';

  const banner = $('#banner');
  const [from] = rangeBounds();
  const gap = isLive() && data.coveredFrom && from && from < data.coveredFrom;
  banner.className = 'banner' + (isLive() ? ' info' : '');
  if (connection.rejected) {
    banner.className = 'banner';
    banner.innerHTML = `<span><strong>Garmin no longer accepts your key.</strong> ${isLive() ? 'Loaded activities stay available; paste a new key to refresh them.' : 'Paste a new key to load your activities.'}</span><button class="link" type="button" data-act="setup">Update key</button>`;
    banner.hidden = false;
    return;
  }
  if (!isLive() && !connection.connected) {
    banner.innerHTML = `<span><strong>You're looking at sample data.</strong> 240 days of made-up runs, rides and swims, so every view has something to show.</span><button class="link" type="button" data-act="setup">Connect your Garmin Connect™ account</button>`;
  } else if (!isLive()) {
    banner.innerHTML = `<span><strong>Connected.</strong> This is still sample data.</span><button class="link" type="button" data-act="load">Load your activities</button>`;
  } else if (gap) {
    banner.innerHTML = `<span>Loaded activities start on ${esc(fmtDate(data.coveredFrom!))}, after the start of this range.</span>${connection.connected ? '<button class="link" type="button" data-act="load">Load the whole range</button>' : ''}`;
  }
  banner.hidden = isLive() && !gap;
}

function buildFilterOptions(): void {
  const counts = new Map<Family, number>();
  data.activities.forEach(a => counts.set(a.fam, (counts.get(a.fam) ?? 0) + 1));
  $('#sportChips').innerHTML = FAMILY_ORDER.filter(k => counts.has(k)).map(k =>
    `<button type="button" class="chip" data-fam="${k}" aria-pressed="${S.f.fams.has(k)}"><i class="sw" style="background:${FAMILIES[k].color}"></i>${FAMILIES[k].label} <span class="ct num">${counts.get(k)}</span></button>`).join('');
  const events = [...new Set(data.activities.map(a => a.event))].sort();
  $('#event').innerHTML = '<option value="">Any</option>' + events.map(e => `<option value="${esc(e)}"${e === S.f.event ? ' selected' : ''}>${esc(typeLabel(e))}</option>`).join('');
}

function syncUnitsUI(): void {
  U = unitsFor(settings.units);
  $$<HTMLButtonElement>('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === settings.units)));
  $$('.u-dist').forEach(e => (e.textContent = U.distL));
}

/* ---------- Tooltip ---------- */

const tip = $('#tip');
function showTip(text: string, x: number, y: number): void {
  tip.textContent = text;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
document.addEventListener('pointermove', e => {
  const t = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
  if (t) showTip(t.dataset.tip ?? '', e.clientX, e.clientY);
  else tip.hidden = true;
});
document.addEventListener('scroll', () => (tip.hidden = true), true);

/* ---------- Charts ---------- */

function niceStep(max: number, n = 4): number {
  if (max <= 0) return 1;
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const VOL: Record<VolMetric, { get: (a: Activity) => number; fmt: (v: number) => string; tick: (v: number) => string }> = {
  time: { get: a => (a.dur ?? 0) / 3600, fmt: v => (v >= 10 ? Math.round(v) + ' h' : v.toFixed(1) + ' h'), tick: v => v + ' h' },
  dist: { get: a => (a.dist ?? 0) / U.dist, fmt: v => v.toFixed(1) + ' ' + U.distL, tick: v => v + ' ' + U.distL },
  elev: { get: a => (a.elev ?? 0) / U.elev, fmt: v => fmtInt(v) + ' ' + U.elevL, tick: v => fmtInt(v) },
  count: { get: () => 1, fmt: v => v + (v === 1 ? ' session' : ' sessions'), tick: v => String(v) },
};

interface Bin { start: Date; end: Date; v: Partial<Record<Family, number>>; total: number; span?: BinSpan }

/** Tooltip lines that say which days a week or month counts and, for a partial one, why. */
function spanLines(b: Bin, monthly: boolean): string[] {
  const s = b.span!, unit = monthly ? 'month' : 'week', count = `${s.days} of ${s.totalDays} days`;
  const lines = [fmtSpan(s.first, s.last)];
  if (s.full) return lines;
  const edge = (d: Date): string => (monthly ? fmtShort(d) : WEEKDAYS[weekdayIndex(d)]);
  if (s.inProgress && !s.startsLate) lines.push(`${unit[0].toUpperCase() + unit.slice(1)} in progress · ${count}`);
  else if (s.startsLate && !s.endsEarly && !s.inProgress) lines.push(`Partial ${unit} · range starts ${edge(s.first)} · ${count}`);
  else if (s.endsEarly && !s.startsLate) lines.push(`Partial ${unit} · range ends ${edge(s.last)} · ${count}`);
  else lines.push(`Partial ${unit} · ${count}`);
  return lines;
}

function renderVolume(): void {
  const el = $('#volChart'), W = Math.max(280, el.clientWidth), H = 230, m = { l: 46, r: 6, t: 8, b: 24 };
  const [from, to] = chartWindow();
  const monthly = (+to - +from) / 864e5 > 7 * 60;
  const bins: Bin[] = [];
  if (monthly) {
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) bins.push({ start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1), v: {}, total: 0 });
  } else {
    for (let d = monday(from); d < to; d = addDays(d, 7)) bins.push({ start: d, end: addDays(d, 7), v: {}, total: 0 });
  }
  const g = VOL[S.vol];
  filtered.forEach(a => {
    const b = bins.find(b => a.start >= b.start && a.start < b.end);
    if (b) b.v[a.fam] = (b.v[a.fam] ?? 0) + g.get(a);
  });
  bins.forEach(b => {
    b.total = Object.values(b.v).reduce((s, x) => s + (x ?? 0), 0);
    b.span = binSpan(b.start, b.end, from, to);
  });
  const max = Math.max(...bins.map(b => b.total), 0);
  if (!filtered.length || !max) {
    el.innerHTML = '<p class="empty">Nothing to chart for this selection.</p>';
    $('#volLegend').innerHTML = '';
    return;
  }
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / bins.length, y = (v: number): number => m.t + ih - (v / top) * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${monthly ? 'Monthly' : 'Weekly'} ${S.vol} by sport">` +
    '<defs><pattern id="partialHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="3" height="6" style="fill:var(--surface)" fill-opacity=".55"></rect></pattern></defs><g class="ax">';
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"></line><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${g.tick(+v.toFixed(2))}</text>`;
  const every = Math.ceil(bins.length / Math.max(2, Math.floor(iw / 62)));
  bins.forEach((b, i) => {
    if (i % every === 0) s += `<text x="${m.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${monthly ? MONTHS[b.start.getMonth()] + (b.start.getMonth() === 0 ? ' ' + String(b.start.getFullYear()).slice(2) : '') : fmtShort(b.start)}</text>`;
  });
  s += '</g>';
  // Legend and tooltip list sports in FAMILY_ORDER; the stack reads the same way top to bottom,
  // so the first sport is the top layer and the stack is built from the last one up.
  const fams = FAMILY_ORDER.filter(f => bins.some(b => b.v[f]));
  // One point per bin at its center; a lone bin spans the whole plot so it still has an area.
  const xs = bins.length > 1 ? bins.map((_, i) => m.l + i * bw + bw / 2) : [m.l, W - m.r];
  const pts = (vals: number[]): string[] => xs.map((x, j) => `${x.toFixed(1)},${y(vals[Math.min(j, vals.length - 1)]).toFixed(1)}`);
  let below = bins.map(() => 0);
  let layers = '';
  [...fams].reverse().forEach(f => {
    const above = below.map((v, i) => v + (bins[i].v[f] ?? 0));
    const topLine = pts(above);
    // A lighter fill under a full-strength line: the line carries the contrast, the fill stays calm.
    layers += `<path d="M${topLine.join('L')}L${pts(below).reverse().join('L')}Z" style="fill:${FAMILIES[f].color}" fill-opacity=".8"></path>` +
      `<path d="M${topLine.join('L')}" fill="none" style="stroke:${FAMILIES[f].color}" stroke-width="1.5" stroke-linejoin="round"></path>`;
    below = above;
  });
  s += `<clipPath id="volArea"><path d="M${pts(below).join('L')}L${xs[xs.length - 1]},${y(0)}L${xs[0]},${y(0)}Z"></path></clipPath>` + layers;
  bins.forEach((b, i) => {
    // Hatching marks weeks or months that count fewer days than a whole one.
    if (b.total && !b.span!.full) {
      const x0 = Math.max(m.l, m.l + i * bw), x1 = Math.min(W - m.r, m.l + (i + 1) * bw);
      s += `<rect x="${x0}" y="${m.t}" width="${x1 - x0}" height="${ih}" fill="url(#partialHatch)" clip-path="url(#volArea)"></rect>`;
    }
  });
  bins.forEach((b, i) => {
    const lines = fams.filter(f => b.v[f]).map(f => `${FAMILIES[f].label}: ${g.fmt(b.v[f]!)}`);
    const tip = [...spanLines(b, monthly), `Total: ${g.fmt(b.total)}`, ...(lines.length > 1 ? lines : [])].join('\n');
    s += `<rect class="hit" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${ih}" data-tip="${esc(tip)}"></rect>`;
  });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--muted)"></line></svg>`;
  el.innerHTML = s;
  // Partial weeks or months would pull the average down; leave them out unless nothing else is left.
  const unit = monthly ? 'month' : 'week';
  const full = bins.filter(b => b.span!.full), counted = full.length ? full : bins;
  const avg = counted.reduce((t, b) => t + b.total, 0) / counted.length;
  const hasPartial = full.length < bins.length;
  $('#volLegend').innerHTML = fams.map(f => `<span><i style="background:${FAMILIES[f].color}"></i>${FAMILIES[f].label}</span>`).join('') +
    (hasPartial ? `<span><i class="partial"></i>Partial ${unit}</span>` : '') +
    `<span style="margin-left:auto">Average per ${hasPartial && full.length ? `full ${unit}` : unit}: <b class="num" style="color:var(--ink)">${g.fmt(S.vol === 'count' ? Math.round(avg * 10) / 10 : avg)}</b></span>`;
}

function renderHeat(): void {
  const el = $('#heat'), cell = 13, gap = 3, step = cell + gap, weeks = 53, ml = 30, mt = 18;
  const [, to] = chartWindow();
  const end = addDays(to, -1), firstMon = addDays(monday(end), -(weeks - 1) * 7);
  // Always a full year: every filter applies except the date range.
  const mins: Record<string, number> = {}, titles: Record<string, string[]> = {};
  inWindow(firstMon, to).forEach(a => {
    mins[a.day] = (mins[a.day] ?? 0) + (a.dur ?? 0) / 60;
    (titles[a.day] ??= []).push(a.name);
  });
  const lvl = (v: number): number => (!v ? 0 : v < 30 ? 0.28 : v < 60 ? 0.48 : v < 90 ? 0.68 : v < 120 ? 0.85 : 1);
  const W = ml + weeks * step, H = mt + 7 * step;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily training minutes over the last 53 weeks"><g class="ax">`;
  [0, 2, 4].forEach(r => (s += `<text x="${ml - 6}" y="${mt + r * step + cell - 2}" text-anchor="end">${WEEKDAYS[r]}</text>`));
  let lastMonth = -1, activeDays = 0;
  for (let w = 0; w < weeks; w++) {
    const wk = addDays(firstMon, w * 7);
    if (wk.getMonth() !== lastMonth && wk.getDate() <= 7) {
      s += `<text x="${ml + w * step}" y="11">${MONTHS[wk.getMonth()]}</text>`;
      lastMonth = wk.getMonth();
    }
    for (let r = 0; r < 7; r++) {
      const d = addDays(wk, r);
      if (d > end) continue;
      const k = dayKey(d), v = mins[k] ?? 0, o = lvl(v);
      if (v) activeDays++;
      const t = `${WEEKDAYS[r]} ${fmtDate(d)}\n` + (v ? `${Math.round(v)} min · ${titles[k].join(', ')}` : 'Rest day');
      s += `<rect x="${ml + w * step}" y="${mt + r * step}" width="${cell}" height="${cell}" rx="2.5" style="fill:${o ? 'var(--heat)' : 'var(--sunk)'}" ${o ? `fill-opacity="${o}"` : ''} data-tip="${esc(t)}"></rect>`;
    }
  }
  el.innerHTML = s + '</g></svg>';
  const sc = $('#heatScroll');
  sc.scrollLeft = sc.scrollWidth;
  $('#heatHint').textContent = `${activeDays} active days in 53 weeks`;
  $('#heatLegend').innerHTML = 'Less ' + [0, 0.28, 0.48, 0.68, 0.85, 1].map(o => `<i style="background:${o ? 'var(--heat)' : 'var(--sunk)'};opacity:${o || 1}"></i>`).join('') + ' More <span style="margin-left:8px">daily minutes: under 30, 60, 90, 120, then longer</span>';
}

function renderTrend(): void {
  const el = $('#trend'), W = Math.max(280, el.clientWidth), H = 230, m = { l: 50, r: 10, t: 10, b: 24 };
  const runs = filtered.filter(a => a.fam === 'run' && (a.dist ?? 0) >= 1500 && (a.dur ?? 0) > 0 && (S.trend === 'pace' || a.avgHR)).sort((a, b) => +a.start - +b.start);
  if (runs.length < 3) {
    el.innerHTML = '<p class="empty">Needs at least three runs in this selection.</p>';
    $('#trendLegend').innerHTML = '';
    return;
  }
  const val = { pace: (a: Activity) => a.dur! / (a.dist! / U.dist), hr: (a: Activity) => a.avgHR!, eff: (a: Activity) => ((a.dist! / U.dist) * 1000) / (a.dur! / 60) / a.avgHR! }[S.trend];
  const label = { pace: (v: number) => fmtMMSS(v), hr: (v: number) => String(Math.round(v)), eff: (v: number) => v.toFixed(2) }[S.trend];
  const pts = runs.map(a => ({ a, t: +a.start, v: val(a) })).filter(p => Number.isFinite(p.v));
  const vs = pts.map(p => p.v).sort((x, y) => x - y);
  const lo = vs[Math.floor(vs.length * 0.03)], hi = vs[Math.ceil(vs.length * 0.97) - 1];
  const padV = (hi - lo) * 0.12 || 1, vmin = lo - padV, vmax = hi + padV;
  const [from, to] = chartWindow();
  const t0 = Math.min(+from, pts[0].t), t1 = Math.max(+to, pts[pts.length - 1].t);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const invert = S.trend === 'pace'; // faster pace sits higher
  const x = (t: number): number => m.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number): number => {
    const r = (Math.min(vmax, Math.max(vmin, v)) - vmin) / (vmax - vmin);
    return m.t + (invert ? r : 1 - r) * ih;
  };
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running ${S.trend} over time"><g class="ax">`;
  const st = niceStep(vmax - vmin, 4);
  for (let v = Math.ceil(vmin / st) * st; v <= vmax; v += st) s += `<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"></line><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${label(v)}</text>`;
  const months: Date[] = [];
  for (let d = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() + 1, 1); +d <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  const every = Math.ceil(months.length / Math.max(2, Math.floor(iw / 56)));
  months.forEach((d, i) => {
    if (i % every === 0) s += `<text x="${x(+d)}" y="${H - 6}" text-anchor="middle">${MONTHS[d.getMonth()]}</text>`;
  });
  s += '</g>';
  // 28-day rolling median
  const line = pts.map(p => [x(p.t), y(median(pts.filter(q => q.t <= p.t && q.t > p.t - 28 * 864e5).map(q => q.v))!)]);
  pts.forEach(p => {
    const a = p.a, race = a.event === 'race';
    const t = `${fmtDate(a.start)} · ${a.name}\n${fmtDistance(a.dist, U)} ${U.distL} · ${paceOrSpeed(a, U)}` + (a.avgHR ? ` · ${Math.round(a.avgHR)} bpm` : '');
    s += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="${race ? 5.5 : 3.6}" style="fill:var(--run);stroke:var(--ink);cursor:pointer" fill-opacity="${race ? 1 : 0.5}" stroke-width="${race ? 1.5 : 0}" data-tip="${esc(t)}" data-id="${esc(a.id)}"></circle>`;
  });
  s += `<polyline points="${line.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" style="fill:none;stroke:var(--ink)" stroke-width="2" stroke-linejoin="round" pointer-events="none"></polyline>`;
  const last = line[line.length - 1];
  el.innerHTML = s + `<circle cx="${last[0]}" cy="${last[1]}" r="4" style="fill:var(--ink)"></circle></svg>`;
  const first6 = median(pts.slice(0, 6).map(p => p.v))!, last6 = median(pts.slice(-6).map(p => p.v))!;
  const better = S.trend === 'pace' ? last6 < first6 : S.trend === 'hr' ? null : last6 > first6;
  const unit = { pace: U.paceL, hr: ' bpm', eff: ` ${U.system === 'metric' ? 'm' : 'mi/1000'} per min per beat` }[S.trend];
  $('#trendLegend').innerHTML = `<span><i style="background:var(--run);opacity:.55;border-radius:50%"></i>Run (races larger)</span><span><i style="background:var(--ink);height:2px"></i>28-day median</span>` +
    `<span style="margin-left:auto">First 6 runs ${label(first6)} → last 6 runs <b class="num" style="color:${better == null ? 'var(--ink)' : better ? 'var(--good)' : 'var(--warn)'}">${label(last6)}</b>${esc(unit)}</span>`;
}

/* ---------- Dashboard blocks ---------- */

const sumOf = (list: Activity[], pick: (a: Activity) => number | null): number => list.reduce((s, a) => s + (pick(a) ?? 0), 0);

function loadNow(): ReturnType<typeof loadComparison> {
  const [, to] = chartWindow();
  return loadComparison(inWindow(addDays(to, -28), to), to);
}

function renderKPIs(): void {
  const L = filtered, [from, to] = chartWindow(), weeks = Math.max(1, (+to - +from) / (7 * 864e5));
  const dur = sumOf(L, a => a.dur), d = sumOf(L, a => a.dist), el = sumOf(L, a => a.elev), cal = sumOf(L, a => a.cal), hr = weightedHR(L);
  const lr = loadNow(), trend = loadTrend(lr.ratio);
  const pill = trend === 'none' ? '<span class="pill muted">no recent data</span>'
    : `<span class="pill ${{ easing: 'warn', steady: 'good', building: 'warn', spike: 'bad' }[trend]}">${lr.ratio!.toFixed(2)} · ${{ easing: 'easing off', steady: 'steady', building: 'building fast', spike: 'spike' }[trend]}</span>`;
  const h = Math.floor(dur / 3600), mm = Math.round((dur % 3600) / 60);
  $('#kpis').innerHTML = [
    ['Activities', `${L.length}`, `${(L.length / weeks).toFixed(1)} per week`],
    ['Moving time', `${h}<small>h</small> ${pad(mm)}<small>m</small>`, `${fmtHours(dur / weeks)} per week`],
    ['Distance', `${fmtInt(d / U.dist)}<small>${U.distL}</small>`, `${(d / U.dist / weeks).toFixed(1)} ${U.distL} per week`],
    ['Elevation gain', `${fmtInt(el / U.elev)}<small>${U.elevL}</small>`, L.length ? `${fmtInt(el / U.elev / weeks)} ${U.elevL} per week` : '–'],
    ['Avg heart rate', hr ? `${Math.round(hr)}<small>bpm</small>` : '–', `${fmtInt(cal)} kcal burned`],
    ['Last 7 days', fmtHours(lr.last7Days).replace(/ m$/, '<small>m</small>').replace(/ h /, '<small>h</small> '), `${pill}<span class="s">vs. ${fmtHours(lr.weeklyAverage4Weeks)} weekly average over 4 weeks</span>`],
  ].map(([k, v, s]) => `<div class="kpi"><span class="eyebrow">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('');
}

function renderMix(): void {
  const by = new Map<Family, { n: number; dur: number; dist: number }>();
  filtered.forEach(a => {
    const b = by.get(a.fam) ?? { n: 0, dur: 0, dist: 0 };
    b.n++; b.dur += a.dur ?? 0; b.dist += a.dist ?? 0;
    by.set(a.fam, b);
  });
  const total = [...by.values()].reduce((s, b) => s + b.dur, 0);
  if (!total) {
    $('#mix').innerHTML = '<p class="empty">No activities in this selection.</p>';
    return;
  }
  $('#mix').innerHTML = FAMILY_ORDER.filter(f => by.has(f)).sort((a, b) => by.get(b)!.dur - by.get(a)!.dur).map(f => {
    const b = by.get(f)!, pct = (b.dur / total) * 100;
    return `<div class="bar-row"><span class="lbl"><i class="sw" style="background:${FAMILIES[f].color}"></i><b>${FAMILIES[f].label}</b></span><span class="val num">${Math.round(pct)}% · ${fmtHours(b.dur)}</span>
      <span class="track"><i style="width:${pct}%;background:${FAMILIES[f].color}"></i></span>
      <span class="val num" style="grid-column:1/-1;text-align:left">${b.n} sessions${b.dist > 0 ? ` · ${fmtInt(b.dist / U.dist)} ${U.distL}` : ''}</span></div>`;
  }).join('');
}

function renderTE(): void {
  const vals = filtered.map(a => a.aerTE).filter((v): v is number => v != null);
  if (!vals.length) {
    $('#teBars').innerHTML = '<p class="empty">No training effect values in this selection.</p>';
    return;
  }
  const counts = TE_BANDS.map(b => vals.filter(v => v >= b[0] && v < b[1]).length), max = Math.max(...counts);
  // Brand orange in steps that grow stronger with more benefit; overreaching takes the ink color,
  // because the warning red sits too close to orange to tell apart. Sport colors stay for sports.
  const colors = ['var(--te-1)', 'var(--te-2)', 'var(--te-3)', 'var(--te-4)', 'var(--te-5)', 'var(--ink)'];
  $('#teBars').innerHTML = TE_BANDS.map((b, i) => `<div class="bar-row"><span class="lbl"><b>${b[2]}</b><span class="val num">${b[0]}${b[1] > 5 ? '' : '–' + (b[1] - 0.1).toFixed(1)}</span></span><span class="val num">${counts[i]}</span><span class="track"><i style="width:${max ? (counts[i] / max) * 100 : 0}%;background:${colors[i]}"></i></span></div>`).join('') +
    `<p class="caption" style="font-size:13px">${Math.round((vals.filter(v => v >= 3).length / vals.length) * 100)}% of sessions improved fitness (3.0 or higher).</p>`;
}

function renderRecords(): void {
  const L = filtered;
  const best = (list: Activity[], f: (a: Activity) => number | null): Activity | null =>
    list.reduce<Activity | null>((b, a) => (f(a) != null && (b == null || f(a)! > f(b)!) ? a : b), null);
  const runs = L.filter(a => a.fam === 'run'), rides = L.filter(a => a.fam === 'ride');
  const fastest = runs.filter(a => (a.dist ?? 0) >= 5000 && a.dur).reduce<Activity | null>((b, a) => (!b || a.dur! / a.dist! < b.dur! / b.dist! ? a : b), null);
  const recs: [string, Activity | null, (a: Activity) => string][] = [
    ['Longest run', best(runs, a => a.dist), a => `${fmtDistance(a.dist, U)} ${U.distL}`],
    ['Fastest run of 5 km or more', fastest, a => paceOrSpeed(a, U)],
    ['Longest ride', best(rides, a => a.dist), a => `${fmtDistance(a.dist, U, 0)} ${U.distL}`],
    ['Most climbing', best(L, a => a.elev), a => `${fmtElevation(a.elev, U)} ${U.elevL}`],
    ['Longest session', best(L, a => a.dur), a => fmtHours(a.dur)],
    ['Hardest session', best(L, a => a.aerTE), a => `TE ${a.aerTE!.toFixed(1)}`],
  ];
  const found = recs.filter((r): r is [string, Activity, (a: Activity) => string] => r[1] != null);
  const prs = L.filter(a => a.pr);
  $('#records').innerHTML = found.length
    ? found.map(([k, a, f]) => `<button type="button" class="rec" data-id="${esc(a.id)}"><span class="k">${k}</span><span class="v">${esc(f(a))}</span><span class="n">${esc(a.name)} · ${fmtShort(a.start)}</span></button>`).join('') +
      (prs.length ? `<button type="button" class="rec" data-pr><span class="k">Personal records</span><span class="v">${prs.length}</span><span class="n">${esc(prs.slice(0, 2).map(a => a.name).join(', '))}</span></button>` : '')
    : '<p class="empty">No activities in this selection.</p>';
}

/* ---------- Activities table ---------- */

interface Col { k: string; l: string | (() => string); v: (a: Activity) => number | string; h: (a: Activity) => string; r?: boolean; cls?: string }

const COLS: Col[] = [
  { k: 'date', l: 'Date', v: a => +a.start, h: a => `${fmtShort(a.start)} <small>${a.start.getFullYear()} · ${fmtTime(a.start)}</small>` },
  { k: 'name', l: 'Activity', v: a => a.name.toLowerCase(), cls: 'name', h: a => `<b>${esc(a.name)}${a.pr ? '<span class="flag pr">PR</span>' : ''}${a.event === 'race' ? '<span class="flag race">Race</span>' : ''}${a.fav ? '<span class="flag fav" title="Favorite">★</span>' : ''}</b><small>${esc([a.location, a.desc].filter(Boolean).join(' · '))}</small>` },
  { k: 'type', l: 'Sport', v: a => a.typeKey, cls: 'hide-sm', h: a => `<span class="sport"><i class="sw" style="background:${FAMILIES[a.fam].color}"></i>${esc(typeLabel(a.typeKey))}</span>` },
  { k: 'dist', l: () => `Dist. ${U.distL}`, v: a => a.dist ?? -1, r: true, h: a => (a.dist ? fmtDistance(a.dist, U, 2) : '–') },
  { k: 'dur', l: 'Time', v: a => a.dur ?? -1, r: true, h: a => fmtDur(a.dur) },
  { k: 'pace', l: 'Pace / speed', v: a => (a.dist && a.dur ? (usesPace(a.fam) ? -a.dur / a.dist : a.dist / a.dur) : -1e9), r: true, cls: 'hide-sm', h: a => paceOrSpeed(a, U) },
  { k: 'elev', l: () => `Climb ${U.elevL}`, v: a => a.elev ?? -1, r: true, cls: 'hide-sm', h: a => (a.elev ? fmtElevation(a.elev, U) : '–') },
  { k: 'hr', l: 'Avg HR', v: a => a.avgHR ?? -1, r: true, cls: 'hide-sm', h: a => (a.avgHR ? String(Math.round(a.avgHR)) : '–') },
  { k: 'te', l: 'Aerobic TE', v: a => a.aerTE ?? -1, cls: 'hide-sm', h: a => (a.aerTE != null ? `<span class="te" data-tip="${teLabel(a.aerTE)}"><i><b style="width:${(a.aerTE / 5) * 100}%"></b></i>${a.aerTE.toFixed(1)}</span>` : '–') },
];

function renderTable(): void {
  const c = COLS.find(c => c.k === S.sort.key)!, dir = S.sort.dir;
  const rows = [...filtered].sort((a, b) => {
    const x = c.v(a), y = c.v(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  $('#thead').innerHTML = COLS.map(col => `<th class="${col.r ? 'r ' : ''}${col.cls === 'hide-sm' ? 'hide-sm' : ''}" ${col.k === S.sort.key ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${col.k}">${typeof col.l === 'function' ? col.l() : col.l}</button></th>`).join('');
  $('#tbody').innerHTML = rows.slice(0, S.shown).map(a => `<tr data-id="${esc(a.id)}" tabindex="0">${COLS.map(col => `<td class="${col.r ? 'r num ' : ''}${col.cls ?? ''}">${col.h(a)}</td>`).join('')}</tr>`).join('') ||
    `<tr><td colspan="${COLS.length}" class="empty" style="text-align:center;cursor:default">No activities match these filters. <button class="link" type="button" data-act="reset">Reset filters</button></td></tr>`;
  $('#listInfo').textContent = rows.length ? `Showing ${Math.min(S.shown, rows.length)} of ${rows.length}` : '';
  $('#more').hidden = S.shown >= rows.length;
}

/* ---------- Detail ---------- */

type Fmt = (v: number) => string;
const DETAIL: [string, string, Fmt][] = [
  ['distance', 'Distance', v => `${fmtDistance(v, U, 2)} ${U.distL}`], ['movingDuration', 'Moving time', fmtDur], ['elapsedDuration', 'Elapsed time', fmtDur], ['duration', 'Timer time', fmtDur],
  ['elevationGain', 'Elevation gain', v => `${fmtElevation(v, U)} ${U.elevL}`], ['elevationLoss', 'Elevation loss', v => `${fmtElevation(v, U)} ${U.elevL}`],
  ['averageSpeed', 'Avg speed', v => `${(v * U.speed).toFixed(1)} ${U.speedL}`], ['maxSpeed', 'Max speed', v => `${(v * U.speed).toFixed(1)} ${U.speedL}`],
  ['averageHR', 'Avg heart rate', v => `${Math.round(v)} bpm`], ['maxHR', 'Max heart rate', v => `${Math.round(v)} bpm`], ['calories', 'Calories', v => `${fmtInt(v)} kcal`],
  ['aerobicTrainingEffect', 'Aerobic TE', v => `${v.toFixed(1)} · ${teLabel(v)}`], ['anaerobicTrainingEffect', 'Anaerobic TE', v => v.toFixed(1)],
  ['trainingStressScore', 'Training stress score', v => v.toFixed(0)], ['intensityFactor', 'Intensity factor', v => v.toFixed(2)], ['vO2MaxValue', 'VO₂ max', v => String(v)],
  ['avgPower', 'Avg power', v => `${Math.round(v)} W`], ['normPower', 'Normalized power', v => `${Math.round(v)} W`], ['max20MinPower', 'Best 20 min power', v => `${Math.round(v)} W`],
  ['averageRunningCadenceInStepsPerMinute', 'Run cadence', v => `${Math.round(v)} spm`], ['averageBikingCadenceInRevPerMinute', 'Bike cadence', v => `${Math.round(v)} rpm`],
  ['avgStrideLength', 'Stride length', v => `${(v / 100).toFixed(2)} m`], ['avgGroundContactTime', 'Ground contact', v => `${Math.round(v)} ms`], ['avgVerticalOscillation', 'Vertical oscillation', v => `${v.toFixed(1)} cm`],
  ['averageSwolf', 'Avg SWOLF', v => String(Math.round(v))], ['activeLengths', 'Active lengths', v => String(v)], ['steps', 'Steps', fmtInt],
  ['minTemperature', 'Min temperature', v => `${v} °C`], ['maxTemperature', 'Max temperature', v => `${v} °C`],
];

function openDetail(id: string | undefined): void {
  const a = data.activities.find(x => String(x.id) === String(id));
  if (!a) return;
  $('#detailMeta').textContent = `${isLive() ? 'Garmin' : 'Sample data'} · ${typeLabel(a.typeKey)} · ${WEEKDAYS[weekdayIndex(a.start)]} ${fmtDate(a.start)}, ${fmtTime(a.start)}${a.location ? ' · ' + a.location : ''}`;
  $('#detailTitle').textContent = a.name;
  const r = a.raw as Record<string, unknown>, sum = (r.summaryDTO ?? {}) as Record<string, unknown>;
  const cells = DETAIL.map(([k, l, f]) => {
    const v = Number(r[k] ?? sum[k]);
    return (r[k] ?? sum[k]) != null && Number.isFinite(v) ? `<div><span>${l}</span><b>${esc(f(v))}</b></div>` : '';
  }).join('');
  const pace = a.dist && a.dur ? `<div><span>${usesPace(a.fam) ? 'Avg pace' : 'Moving speed'}</span><b>${esc(paceOrSpeed(a, U))}</b></div>` : '';
  $('#detailBody').innerHTML = `
    ${a.desc ? `<p style="margin:0;max-width:68ch">${esc(a.desc)}</p>` : ''}
    <div class="frow">${a.pr ? '<span class="pill mark">Personal record</span>' : ''}${a.event !== 'uncategorized' ? `<span class="pill muted">${esc(typeLabel(a.event))}</span>` : ''}${a.fav ? '<span class="pill warn">★ Favorite</span>' : ''}</div>
    <div class="metric-grid">${pace}${cells}</div>
    <p class="caption">${isLive() ? 'Data provided by Garmin.' : 'Sample data, made up for illustration.'}</p>
    <div class="frow">
      <button class="btn accent small" type="button" id="copyOne">Copy for AI</button>
      ${a.id != null && isLive() ? `<a class="btn small" href="https://connect.garmin.com/modern/activity/${encodeURIComponent(String(a.id))}" target="_blank" rel="noopener">Open in Garmin Connect ↗</a>` : ''}
      <span class="status" id="oneMsg" role="status"></span>
    </div>
    <details class="more"><summary>Raw API record</summary><pre class="code">${esc(JSON.stringify(a.raw, null, 2))}</pre></details>`;
  $('#copyOne').addEventListener('click', async () => {
    const brief = buildBrief({ activities: [a], source: data.source, settings, filterDescription: 'one activity', context: data.activities.filter(x => x.fam === a.fam) });
    const ok = await copyText(brief.text);
    setStatus($('#oneMsg'), ok ? 'Copied. Paste it into your AI chat.' : "Couldn't copy.", ok ? 'ok' : 'err');
  });
  const dlg = $<HTMLDialogElement>('#detailDlg');
  if (!dlg.open) dlg.showModal();
}

/* ---------- Export ---------- */

let lastExport: ExportResult | null = null;

function syncExportForm(): void {
  const e = settings.export, form = $<HTMLFormElement>('#exportOpts');
  $$<HTMLInputElement>('input[name="format"]', form).forEach(i => (i.checked = i.value === e.format));
  $$<HTMLInputElement>('input[name="detail"]', form).forEach(i => (i.checked = i.value === e.detail));
  (Object.keys(e.sections) as (keyof ExportSections)[]).forEach(k => ($<HTMLInputElement>(`input[name="${k}"]`, form).checked = e.sections[k]));
  $<HTMLInputElement>('input[name="privacy"]', form).checked = e.privacy;
  const ta = $<HTMLTextAreaElement>('#instructions');
  if (document.activeElement !== ta) ta.value = e.instructions;
  $('#instructionsField').hidden = !e.sections.instructions;
}

function renderExport(): void {
  syncExportForm();
  const [from, to] = rangeBounds();
  const period: DateRange | undefined = from || to ? { from, to: to ?? addDays(startOfDay(new Date()), 1) } : undefined;
  lastExport = buildBrief({ activities: filtered, source: data.source, settings, period, filterDescription: describeFilters(), context: inWindow(new Date(0), addDays(startOfDay(new Date()), 1)) });
  $<HTMLTextAreaElement>('#exportOut').value = lastExport.text;
  $('#exportStats').textContent = `${filtered.length} activities · ${fmtSize(lastExport.chars)} · about ${fmtTokens(lastExport.tokens)} tokens`;
  const v = sizeVerdict(lastExport.tokens);
  $('#exportSize').textContent = v.message;
  $('#exportSize').className = `size ${v.level}`;
}

function readExportForm(): void {
  const form = $<HTMLFormElement>('#exportOpts');
  const checked = (name: string): boolean => $<HTMLInputElement>(`input[name="${name}"]`, form).checked;
  const patch = {
    format: ($<HTMLInputElement>('input[name="format"]:checked', form).value as ExportFormat),
    detail: ($<HTMLInputElement>('input[name="detail"]:checked', form).value === 'full' ? 'full' : 'core') as 'full' | 'core',
    sections: { instructions: checked('instructions'), about: checked('about'), summary: checked('summary'), weekly: checked('weekly'), activities: checked('activities') },
    privacy: checked('privacy'),
  };
  settings = { ...settings, export: { ...settings.export, ...patch } };
  void updateSettings({ export: patch });
  renderExport();
}

/* ---------- Render ---------- */

function renderAll(): void {
  applyFilters();
  renderHeader();
  $('#count').textContent = `${filtered.length} of ${data.activities.length} activities`;
  $('#customRange').hidden = S.f.range !== 'custom';
  $$<HTMLButtonElement>('#sportChips .chip').forEach(c => c.setAttribute('aria-pressed', String(S.f.fams.has(c.dataset.fam as Family))));
  renderView();
}

function renderView(): void {
  if (S.view === 'dashboard') { renderKPIs(); renderVolume(); renderMix(); renderHeat(); renderTrend(); renderTE(); renderRecords(); }
  if (S.view === 'activities') renderTable();
  if (S.view === 'export') renderExport();
}

function setView(v: string, push = true): void {
  const view: View = v === 'activities' || v === 'export' ? v : 'dashboard';
  S.view = view;
  $$('nav.tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t.getAttribute('aria-controls') === view)));
  (['dashboard', 'activities', 'export'] as View[]).forEach(id => ($(`#${id}`).hidden = id !== view));
  if (push) history.replaceState(null, '', '#' + view);
  renderView();
}

async function reload(): Promise<void> {
  const before = data.source;
  [data, settings, connection] = await Promise.all([loadDataset(), getSettings(), connectionStatus()]);
  syncUnitsUI();
  // Real data may end before the default window; show it all rather than an empty dashboard.
  if (before !== 'garmin' && data.source === 'garmin' && data.activities.length && data.activities[0].start < addDays(new Date(), -90)) {
    S.f.range = 'all';
    $<HTMLSelectElement>('#range').value = 'all';
  }
  S.f.fams = new Set([...S.f.fams].filter(f => data.activities.some(a => a.fam === f)));
  buildFilterOptions();
  renderAll();
}

async function loadFromGarminClicked(): Promise<void> {
  if (loading) return;
  loading = true;
  const btn = $<HTMLButtonElement>('#loadBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const [from] = rangeBounds();
    await loadFromGarmin(from, n => (btn.textContent = `Loaded ${n}…`));
    loading = false;
    await reload();
  } catch (err) {
    loading = false;
    connection = await connectionStatus();
    renderHeader();
    if (connection.rejected) return;
    const banner = $('#banner');
    banner.className = 'banner';
    banner.hidden = false;
    banner.innerHTML = `<span><strong>Couldn't load from Garmin.</strong> ${esc(describeError(err))}</span><button class="link" type="button" data-act="setup">Open settings</button>`;
  }
}

/* ---------- Events ---------- */

let qTimer: ReturnType<typeof setTimeout> | undefined;
const input = <T extends HTMLElement>(sel: string): T => $<T>(sel);
input<HTMLInputElement>('#q').addEventListener('input', e => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { S.f.q = (e.target as HTMLInputElement).value.trim(); S.shown = 60; renderAll(); }, 120);
});
input<HTMLSelectElement>('#range').addEventListener('change', e => {
  S.f.range = (e.target as HTMLSelectElement).value;
  if (S.f.range === 'custom' && !S.f.from) {
    S.f.from = dayKey(chartWindow()[0]);
    input<HTMLInputElement>('#from').value = S.f.from;
  }
  renderAll();
});
input<HTMLInputElement>('#from').addEventListener('change', e => { S.f.from = (e.target as HTMLInputElement).value; renderAll(); });
input<HTMLInputElement>('#to').addEventListener('change', e => { S.f.to = (e.target as HTMLInputElement).value; renderAll(); });
$('#sportChips').addEventListener('click', e => {
  const c = (e.target as Element).closest<HTMLElement>('.chip');
  const f = c?.dataset.fam;
  if (!isFamily(f)) return;
  if (S.f.fams.has(f)) S.f.fams.delete(f);
  else S.f.fams.add(f);
  S.shown = 60;
  renderAll();
});
input<HTMLSelectElement>('#event').addEventListener('change', e => { S.f.event = (e.target as HTMLSelectElement).value; renderAll(); });
(['minDist', 'maxDist', 'minDur', 'maxDur'] as const).forEach(k => input<HTMLInputElement>('#' + k).addEventListener('input', e => { S.f[k] = (e.target as HTMLInputElement).value; renderAll(); }));
input<HTMLInputElement>('#prOnly').addEventListener('change', e => { S.f.pr = (e.target as HTMLInputElement).checked; renderAll(); });
input<HTMLInputElement>('#favOnly').addEventListener('change', e => { S.f.fav = (e.target as HTMLInputElement).checked; renderAll(); });

function resetFilters(): void {
  S.f = freshFilters();
  input<HTMLInputElement>('#q').value = '';
  input<HTMLSelectElement>('#range').value = '90';
  input<HTMLInputElement>('#from').value = '';
  input<HTMLInputElement>('#to').value = '';
  input<HTMLSelectElement>('#event').value = '';
  (['minDist', 'maxDist', 'minDur', 'maxDur'] as const).forEach(k => (input<HTMLInputElement>('#' + k).value = ''));
  input<HTMLInputElement>('#prOnly').checked = false;
  input<HTMLInputElement>('#favOnly').checked = false;
  if (isLive() && data.activities.length && data.activities[0].start < addDays(new Date(), -90)) {
    S.f.range = 'all';
    input<HTMLSelectElement>('#range').value = 'all';
  }
  renderAll();
}
$('#resetFilters').addEventListener('click', resetFilters);

$('#units').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-units]');
  if (!b) return;
  settings = { ...settings, units: b.dataset.units === 'imperial' ? 'imperial' : 'metric' };
  void updateSettings({ units: settings.units });
  syncUnitsUI();
  renderAll();
});
$$('nav.tabs [role=tab]').forEach(t => t.addEventListener('click', () => setView(t.getAttribute('aria-controls') ?? '')));
$('nav.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tabs = $$<HTMLButtonElement>('nav.tabs [role=tab]'), i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
  const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  n.focus();
  setView(n.getAttribute('aria-controls') ?? '');
});
$('#volMetric').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  S.vol = b.dataset.v as VolMetric;
  $$('#volMetric button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderVolume();
});
$('#trendMetric').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  S.trend = b.dataset.v as TrendMetric;
  $$('#trendMetric button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderTrend();
});
$('#thead').addEventListener('click', e => {
  const k = (e.target as Element).closest<HTMLElement>('[data-sort]')?.dataset.sort;
  if (!k) return;
  S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : k === 'name' || k === 'type' ? 1 : -1 };
  renderTable();
});
$('#tbody').addEventListener('click', e => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]');
  if (tr) openDetail(tr.dataset.id);
});
$('#tbody').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]');
  if (tr) openDetail(tr.dataset.id);
});
$('#more').addEventListener('click', () => { S.shown += 60; renderTable(); });
$('#records').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLElement>('.rec');
  if (!b) return;
  if (b.hasAttribute('data-pr')) {
    S.f.pr = true;
    input<HTMLInputElement>('#prOnly').checked = true;
    $<HTMLDetailsElement>('#moreFilters').open = true;
    renderAll();
    setView('activities');
    return;
  }
  openDetail(b.dataset.id);
});
$('#trend').addEventListener('click', e => {
  const c = (e.target as Element).closest<HTMLElement>('[data-id]');
  if (c) openDetail(c.dataset.id);
});
$('#exportOpts').addEventListener('change', e => {
  if ((e.target as Element).id !== 'instructions') readExportForm();
});
$('#exportOpts').addEventListener('submit', e => e.preventDefault());
// Own timer, so typing in the search box can't cancel a pending save.
let instructionsTimer: ReturnType<typeof setTimeout> | undefined;
let pendingInstructions: string | undefined;
const saveInstructions = (): void => {
  clearTimeout(instructionsTimer);
  const value = pendingInstructions;
  if (value === undefined) return;
  pendingInstructions = undefined;
  settings = { ...settings, export: { ...settings.export, instructions: value } };
  void updateSettings({ export: { instructions: value } });
  renderExport();
};
$('#instructions').addEventListener('input', e => {
  clearTimeout(instructionsTimer);
  pendingInstructions = (e.target as HTMLTextAreaElement).value;
  instructionsTimer = setTimeout(saveInstructions, 250);
});
$('#copyExport').addEventListener('click', async () => {
  saveInstructions();
  if (!lastExport) return;
  const ok = await copyText(lastExport.text);
  setStatus($('#exportMsg'), ok ? 'Copied. Paste it into your AI chat.' : "Couldn't copy here. Use Save as file instead.", ok ? 'ok' : 'err');
});
$('#downloadExport').addEventListener('click', () => {
  saveInstructions();
  if (!lastExport) return;
  downloadExport(lastExport);
  setStatus($('#exportMsg'), `Saved ${lastExport.filename}.`, 'ok');
});
$('#loadBtn').addEventListener('click', () => void loadFromGarminClicked());
$('#settingsBtn').addEventListener('click', () => void openSettings());
document.addEventListener('click', e => {
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'setup') void openSettings();
  if (act === 'load') void loadFromGarminClicked();
  if (act === 'reset') resetFilters();
});
$$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog')!.close()));
$$<HTMLDialogElement>('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

let rz: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  clearTimeout(rz);
  rz = setTimeout(() => { if (S.view === 'dashboard') { renderVolume(); renderTrend(); } }, 120);
}).observe($('#dashboard'));

onStorageChange(topics => {
  if (loading) return;
  // Our own settings writes come back here too; only re-read what can't already be on screen.
  if (topics.has('data') || topics.has('credentials')) void reload();
  else if (topics.has('settings')) void getSettings().then(s => { settings = s; syncUnitsUI(); renderAll(); });
});
addEventListener('hashchange', () => setView(location.hash.slice(1), false));

/* ---------- Boot ---------- */

void reload().then(() => setView(location.hash.slice(1), false));
