import { looksLikeJwt, fmtTime } from '@training-brief/core';
import { connect, connectionStatus, describeError, disconnect, loadFromGarmin } from '../lib/garmin.ts';
import { openDashboard } from '../lib/nav.ts';
import { clearData, getData, getSettings, onStorageChange, updateSettings } from '../lib/storage.ts';
import { $, $$, setStatus } from '../lib/ui.ts';

const secret = $<HTMLInputElement>('#secret');
const isToken = $<HTMLInputElement>('#isToken');

async function render(): Promise<void> {
  const [status, settings, data] = await Promise.all([connectionStatus(), getSettings(), getData()]);
  $('#connected').hidden = !status.connected;
  $('#connectForm').hidden = status.connected;
  if (status.connected) {
    const kind = status.hasKey ? 'Key saved in this browser' : 'Using a pasted access token';
    const until = status.token ? `; token valid until ${fmtTime(new Date(status.token.expiresAt))}` : '; a new token is requested on the next load';
    $('#connectedInfo').textContent = kind + until + '.';
    $('#forget').textContent = status.hasKey ? 'Forget key' : 'Forget token';
  }
  $$<HTMLButtonElement>('#units button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === settings.units)));
  $<HTMLInputElement>('#remember').checked = settings.remember;
  $<HTMLButtonElement>('#clearData').disabled = !data;
}

async function loadAll(msgEl: HTMLElement): Promise<void> {
  setStatus(msgEl, 'Loading activities…');
  try {
    const { data } = await loadFromGarmin(null, n => setStatus(msgEl, `Loaded ${n} activities…`));
    setStatus(msgEl, `Loaded ${data.raw.length} activities. Open the side panel or the dashboard to export them.`, 'ok');
  } catch (err) {
    setStatus(msgEl, describeError(err), 'err');
  }
}

secret.addEventListener('input', () => {
  const jwt = looksLikeJwt(secret.value);
  if (jwt) isToken.checked = true;
  $('#tokenHint').hidden = !(jwt || isToken.checked);
});
isToken.addEventListener('change', () => ($('#tokenHint').hidden = !isToken.checked));
$('#reveal').addEventListener('click', e => {
  const show = secret.type === 'password';
  secret.type = show ? 'text' : 'password';
  (e.currentTarget as HTMLElement).textContent = show ? 'Hide' : 'Show';
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(show));
});

$('#connectForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl = $('#connectMsg'), btn = $<HTMLButtonElement>('#connect');
  btn.disabled = true;
  setStatus(msgEl, isToken.checked ? 'Saving token…' : 'Checking your key with Garmin…');
  try {
    await connect(secret.value, { isToken: isToken.checked });
    secret.value = '';
    isToken.checked = false;
    await render();
    await loadAll($('#loadMsg'));
  } catch (err) {
    setStatus(msgEl, describeError(err), 'err');
  } finally {
    btn.disabled = false;
  }
});

$('#loadNow').addEventListener('click', async e => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  await loadAll($('#loadMsg'));
  btn.disabled = false;
  await render();
});
$('#forget').addEventListener('click', async () => {
  await disconnect();
  await render();
  setStatus($('#connectMsg'), 'Key forgotten. Loaded activities stay until you delete them below.', 'ok');
});
$('#units').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (b) void updateSettings({ units: b.dataset.v === 'imperial' ? 'imperial' : 'metric' });
});
$('#remember').addEventListener('change', e => void updateSettings({ remember: (e.target as HTMLInputElement).checked }));
$('#clearData').addEventListener('click', async () => {
  await clearData();
  setStatus($('#dataMsg'), 'Loaded activities deleted. The dashboard shows sample data again.', 'ok');
});
$('#openDashboard').addEventListener('click', () => void openDashboard());

onStorageChange(() => void render());
void render();
