import { COACH_PROMPT, DEFAULT_SECTIONS, type AccessToken, type ExportDetail, type ExportFormat, type ExportSections, type GarminActivity, type UnitSystem } from '@training-brief/core';

/**
 * Everything lives in chrome.storage on this device. The API key and token stay in
 * chrome.storage.local and are only ever read by the Garmin connection code.
 */

export interface ExportSettings {
  format: ExportFormat;
  detail: ExportDetail;
  sections: ExportSections;
  privacy: boolean;
  instructions: string;
}

export interface Settings {
  units: UnitSystem;
  /** Keep loaded activities after the browser closes. Otherwise they live in session storage. */
  remember: boolean;
  export: ExportSettings;
}

export interface Credentials {
  /** The Personal API key, or null when the user pasted only an access token. */
  apiKey: string | null;
  token: AccessToken | null;
}

export interface StoredData {
  raw: GarminActivity[];
  /** Epoch ms of the last load. */
  loadedAt: number;
  /** YYYY-MM-DD: the earliest day the loaded data is complete for. */
  coveredFrom: string;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'metric',
  remember: true,
  export: { format: 'md', detail: 'core', sections: { ...DEFAULT_SECTIONS }, privacy: true, instructions: COACH_PROMPT },
};

const KEYS = { settings: 'settings', credentials: 'credentials', data: 'data' } as const;

export async function getSettings(): Promise<Settings> {
  const { [KEYS.settings]: s } = await chrome.storage.local.get(KEYS.settings);
  const saved = (s ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    export: { ...DEFAULT_SETTINGS.export, ...saved.export, sections: { ...DEFAULT_SETTINGS.export.sections, ...saved.export?.sections } },
  };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'export'>> & { export?: Partial<ExportSettings> }): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, export: { ...current.export, ...patch.export } };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  if (patch.remember != null && patch.remember !== current.remember) await moveData(patch.remember);
  return next;
}

export async function getCredentials(): Promise<Credentials | null> {
  const { [KEYS.credentials]: c } = await chrome.storage.local.get(KEYS.credentials);
  return (c as Credentials | undefined) ?? null;
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await chrome.storage.local.set({ [KEYS.credentials]: c });
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.remove(KEYS.credentials);
}

const dataArea = (remember: boolean): chrome.storage.StorageArea => (remember ? chrome.storage.local : chrome.storage.session);

export async function getData(): Promise<StoredData | null> {
  const { remember } = await getSettings();
  const { [KEYS.data]: d } = await dataArea(remember).get(KEYS.data);
  return (d as StoredData | undefined) ?? null;
}

export async function saveData(data: StoredData): Promise<void> {
  const { remember } = await getSettings();
  await dataArea(remember).set({ [KEYS.data]: data });
  await dataArea(!remember).remove(KEYS.data);
}

export async function clearData(): Promise<void> {
  await Promise.all([chrome.storage.local.remove(KEYS.data), chrome.storage.session.remove(KEYS.data)]);
}

async function moveData(remember: boolean): Promise<void> {
  const { [KEYS.data]: d } = await dataArea(!remember).get(KEYS.data);
  if (d) await dataArea(remember).set({ [KEYS.data]: d });
  await dataArea(!remember).remove(KEYS.data);
}

export type StorageTopic = keyof typeof KEYS;

/** Calls back when another page changes settings, credentials or loaded data. */
export function onStorageChange(callback: (topics: Set<StorageTopic>) => void): void {
  chrome.storage.onChanged.addListener(changes => {
    const topics = new Set(Object.keys(changes).filter((k): k is StorageTopic => k in KEYS));
    if (topics.size) callback(topics);
  });
}
