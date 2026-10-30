import {
  ACTIVITY_PROMPT, COACH_PROMPT, FAMILIES, FAMILY_ORDER, fmtDate, fmtHours, fmtShort, fmtTime, isFamily, lastDays, RACE_PROMPT, sizeVerdict,
  totals, unitsFor, fmtDistance, type Activity, type ExportResult, type Family,
} from '@training-brief/core';
import { buildBrief } from '../lib/brief.ts';
import { loadDataset, type Dataset } from '../lib/dataset.ts';
import { connectionStatus, describeError, loadFromGarmin, type ConnectionStatus } from '../lib/garmin.ts';
import { openDashboard, openSettings } from '../lib/nav.ts';
import { getSettings, onStorageChange, updateSettings, type Settings } from '../lib/storage.ts';
import { $, $$, copyText, downloadExport, esc, fmtSize, fmtTokens, fmtWhen, setStatus } from '../lib/ui.ts';

type Preset = 'coach' | 'race' | 'one' | null;

interface PanelState {
  preset: Preset;
  days: number;
  sport: Family | '';
  activityId: string;
}

const PRESETS: Record<Exclude<Preset, null>, { days?: number; sport?: Family | ''; prompt: string }> = {
  coach: { days: 56, sport: '', prompt: COACH_PROMPT },
  race: { days: 84, sport: 'run', prompt: RACE_PROMPT },
  one: { prompt: ACTIVITY_PROMPT },
};

const STATE_KEY = 'tb.panel';
const restoreState = (): PanelState => {
  const fallback: PanelState = { preset: 'coach', days: 56, sport: '', activityId: '' };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Partial<PanelState>) };
  } catch {
    return fallback;
  }
};
const saveState = (): void => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Remembering the panel's choices is a convenience only.
  }
};

let state = restoreState();
let dataset: Dataset;
let settings: Settings;
let connection: ConnectionStatus;
let current: ExportResult | null = null;
let loading = false;

const msg = $('#msg');

/* ---------- Selection ---------- */

function sportMatches(a: Activity): boolean {
  return !state.sport || a.fam === state.sport;
}

function selection(): { list: Activity[]; context: Activity[]; period?: ReturnType<typeof lastDays>; description: string } {
  const context = dataset.activities.filter(sportMatches);
  const sportText = state.sport ? `${FAMILIES[state.sport].label.toLowerCase()} only` : 'all sports';
  if (state.preset === 'one') {
    const one = context.find(a => String(a.id) === state.activityId) ?? context[0];
    return { list: one ? [one] : [], context, description: 'one activity' };
  }
  const period = lastDays(state.days);
  const list = context.filter(a => a.start >= period.from! && a.start < period.to!);
  const periodText = $<HTMLSelectElement>('#period').selectedOptions[0]?.text.toLowerCase() ?? '';
  return { list, context, period, description: `${periodText}; ${sportText}` };
}

/* ---------- Rendering ---------- */

function renderSource(): void {
  const el = $('#source');
  if (dataset.source === 'garmin') {
    el.innerHTML = `<i class="dot live"></i><span>Data: <b>Garmin</b> · ${dataset.activities.length} activities · loaded ${esc(fmtWhen(dataset.loadedAt ?? Date.now()))}</span>`;
  } else {
    el.innerHTML = '<i class="dot sample"></i><span><b>Sample data</b> · made up, not from any device</span>';
  }
}

function renderConnection(): void {
  const el = $('#connection');
  el.classList.toggle('sample', dataset.source === 'sample');
  const loadLabel = dataset.source === 'garmin' ? 'Refresh' : 'Load activities';
  if (connection.rejected) {
    el.innerHTML = `<div class="row"><span class="attribution"><i class="dot off"></i>Garmin no longer accepts your key.${dataset.source === 'garmin' ? ' Loaded activities stay available.' : ''}</span><button class="btn ${dataset.source === 'sample' ? 'primary' : ''} small" type="button" data-act="setup">Update key</button></div>`;
    return;
  }
  if (!connection.connected) {
    el.innerHTML = dataset.source === 'sample'
      ? `<p><b>Try it with sample data,</b> or connect Garmin Connect™ with your own Personal API key to export your activities.</p>
         <div class="row"><span class="attribution"><i class="dot off"></i>Not connected</span><button class="btn primary small" type="button" data-act="setup">Connect Garmin</button></div>`
      : `<div class="row"><span class="attribution"><i class="dot off"></i>Not connected. Loaded activities stay available.</span><button class="btn small" type="button" data-act="setup">Connect</button></div>`;
    return;
  }
  const until = connection.token ? `token valid until ${fmtTime(new Date(connection.token.expiresAt))}` : 'a new token is requested when you load';
  el.innerHTML = `
    ${dataset.source === 'sample' ? '<p><b>Connected.</b> Load your activities to replace the sample data.</p>' : ''}
    <div class="row"><span class="attribution"><i class="dot live"></i>Connected · ${esc(until)}</span>
    <button class="btn ${dataset.source === 'sample' ? 'primary' : ''} small" type="button" data-act="load" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : loadLabel}</button></div>`;
}

function renderPickers(): void {
  $$<HTMLButtonElement>('#presets .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.preset === state.preset)));
  const counts = new Map<Family, number>();
  dataset.activities.forEach(a => counts.set(a.fam, (counts.get(a.fam) ?? 0) + 1));
  const sport = $<HTMLSelectElement>('#sport');
  sport.innerHTML = '<option value="">All sports</option>' + FAMILY_ORDER.filter(f => counts.has(f) || f === state.sport).map(f => `<option value="${f}">${esc(FAMILIES[f].label)}</option>`).join('');
  sport.value = state.sport;
  $<HTMLSelectElement>('#period').value = String(state.days);
  const one = state.preset === 'one';
  $('#periodField').hidden = one;
  $('#activityField').hidden = !one;
  if (one) {
    const u = unitsFor(settings.units);
    const recent = dataset.activities.filter(sportMatches).slice(0, 60);
    if (!recent.some(a => String(a.id) === state.activityId)) state.activityId = recent[0] ? String(recent[0].id) : '';
    $<HTMLSelectElement>('#activity').innerHTML = recent.map(a =>
      `<option value="${esc(a.id)}">${esc(`${fmtShort(a.start)} · ${a.name}${a.dist ? ` · ${fmtDistance(a.dist, u)} ${u.distL}` : ''}`)}</option>`).join('') || '<option value="">No activities</option>';
    $<HTMLSelectElement>('#activity').value = state.activityId;
  }
}

function renderCoverage(): void {
  const el = $('#coverage');
  const period = state.preset === 'one' ? null : lastDays(state.days);
  const gap = dataset.source === 'garmin' && dataset.coveredFrom && period?.from && period.from < dataset.coveredFrom;
  el.hidden = !gap;
  if (gap) {
    el.innerHTML = `Loaded data starts ${esc(fmtDate(dataset.coveredFrom!))}. ${connection.connected ? '<button class="link" type="button" data-act="load-earlier">Load the whole period</button>' : ''}`;
    el.className = 'status coverage warn';
  }
}

function renderExportOptions(): void {
  const e = settings.export;
  $$<HTMLButtonElement>('#format button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === e.format)));
  $$<HTMLButtonElement>('#detail button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === e.detail)));
  $<HTMLInputElement>('#privacy').checked = e.privacy;
  const ta = $<HTMLTextAreaElement>('#instructions');
  if (document.activeElement !== ta) ta.value = e.instructions;
}

function renderStats(): void {
  const sel = selection();
  current = buildBrief({ activities: sel.list, source: dataset.source, settings, period: sel.period, filterDescription: sel.description, context: sel.context });
  const t = totals(sel.list);
  $('#statSessions').textContent = String(t.sessions);
  $('#statTime').textContent = fmtHours(t.duration);
  $('#statTokens').textContent = `~${fmtTokens(current.tokens)}`;
  const verdict = sizeVerdict(current.tokens);
  const hint = $('#sizeHint');
  hint.textContent = sel.list.length ? `${fmtSize(current.chars)} · ${verdict.message}` : 'No activities in this selection.';
  hint.className = `size ${sel.list.length ? verdict.level : 'too_large'}`;
  $<HTMLButtonElement>('#copy').disabled = !sel.list.length;
  $<HTMLButtonElement>('#save').disabled = !sel.list.length;
}

function render(): void {
  renderSource();
  renderConnection();
  renderPickers();
  renderCoverage();
  renderExportOptions();
  renderStats();
}

async function refresh(): Promise<void> {
  [dataset, settings, connection] = await Promise.all([loadDataset(), getSettings(), connectionStatus()]);
  render();
}

/* ---------- Actions ---------- */

async function load(neededFrom: Date | null): Promise<void> {
  if (loading) return;
  loading = true;
  renderConnection();
  setStatus(msg, 'Loading activities from Garmin…');
  try {
    const { data, added } = await loadFromGarmin(neededFrom, n => setStatus(msg, `Loaded ${n} activities…`));
    await refresh();
    setStatus(msg, added > 0 ? `Loaded ${data.raw.length} activities (${added} new).` : `Up to date: ${data.raw.length} activities.`, 'ok');
  } catch (err) {
    setStatus(msg, describeError(err), 'err');
    connection = await connectionStatus();
  } finally {
    loading = false;
    renderConnection();
  }
}

function applyPreset(p: Exclude<Preset, null>): void {
  const preset = PRESETS[p];
  state = { ...state, preset: p, days: preset.days ?? state.days, sport: preset.sport ?? state.sport };
  saveState();
  void updateSettings({ export: { instructions: preset.prompt } });
  settings = { ...settings, export: { ...settings.export, instructions: preset.prompt } };
  render();
}

function setExportSetting(patch: Partial<Settings['export']>): void {
  settings = { ...settings, export: { ...settings.export, ...patch } };
  void updateSettings({ export: patch });
  renderExportOptions();
  renderStats();
}

$('#presets').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-preset]');
  if (b) applyPreset(b.dataset.preset as Exclude<Preset, null>);
});
$('#period').addEventListener('change', e => {
  state = { ...state, days: Number((e.target as HTMLSelectElement).value), preset: null };
  saveState();
  render();
});
$('#sport').addEventListener('change', e => {
  const v = (e.target as HTMLSelectElement).value;
  state = { ...state, sport: isFamily(v) ? v : '', preset: state.preset === 'one' ? 'one' : null };
  saveState();
  render();
});
$('#activity').addEventListener('change', e => {
  state = { ...state, activityId: (e.target as HTMLSelectElement).value };
  saveState();
  renderStats();
});
$('#format').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (b) setExportSetting({ format: b.dataset.v as Settings['export']['format'] });
});
$('#detail').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (b) setExportSetting({ detail: b.dataset.v as Settings['export']['detail'] });
});
$('#privacy').addEventListener('change', e => setExportSetting({ privacy: (e.target as HTMLInputElement).checked }));
let typing: ReturnType<typeof setTimeout> | undefined;
$('#instructions').addEventListener('input', e => {
  clearTimeout(typing);
  const value = (e.target as HTMLTextAreaElement).value;
  typing = setTimeout(() => setExportSetting({ instructions: value }), 300);
});

$('#copy').addEventListener('click', async () => {
  if (!current) return;
  const ok = await copyText(current.text);
  setStatus(msg, ok ? 'Copied. Paste it into your AI chat.' : "Couldn't copy here. Use Save as file instead.", ok ? 'ok' : 'err');
});
$('#save').addEventListener('click', () => {
  if (!current) return;
  downloadExport(current);
  setStatus(msg, `Saved ${current.filename}.`, 'ok');
});
$('#openDashboard').addEventListener('click', () => void openDashboard());
$('#openSettings').addEventListener('click', () => void openSettings());
document.addEventListener('click', e => {
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'setup') void openSettings();
  if (act === 'load') void load(state.preset === 'one' ? null : lastDays(state.days).from);
  if (act === 'load-earlier') void load(lastDays(state.days).from);
});

onStorageChange(() => {
  if (!loading) void refresh();
});

void refresh();
