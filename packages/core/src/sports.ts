import type { Family } from './types.ts';

export interface FamilyInfo {
  label: string;
  /** CSS custom property holding the sport color. */
  color: string;
}

export const FAMILIES: Record<Family, FamilyInfo> = {
  run: { label: 'Running', color: 'var(--run)' },
  ride: { label: 'Cycling', color: 'var(--ride)' },
  swim: { label: 'Swimming', color: 'var(--swim)' },
  gym: { label: 'Strength & gym', color: 'var(--gym)' },
  walk: { label: 'Walking & hiking', color: 'var(--walk)' },
  other: { label: 'Other', color: 'var(--other)' },
};

export const FAMILY_ORDER = Object.keys(FAMILIES) as Family[];

export function isFamily(v: unknown): v is Family {
  return typeof v === 'string' && v in FAMILIES;
}

/** Groups Garmin's many activity type keys into a few sports. */
export function familyOf(typeKey: string | null | undefined): Family {
  const key = (typeKey ?? '').toLowerCase();
  if (/swim/.test(key)) return 'swim';
  if (/run/.test(key)) return 'run';
  if (/cycl|bik|ride|spin/.test(key)) return 'ride';
  if (/strength|fitness_equipment|hiit|yoga|pilates|cardio|elliptical|stair|rowing|crossfit|boulder|climb|training/.test(key)) return 'gym';
  if (/walk|hik|mountaineer/.test(key)) return 'walk';
  return 'other';
}

/** "trail_running" → "Trail running". */
export const typeLabel = (key: string | null | undefined): string =>
  (key || 'other').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** Garmin's training effect scale, [from, to, label]. */
export const TE_BANDS: [number, number, string][] = [
  [0, 1, 'No benefit'],
  [1, 2, 'Minor benefit'],
  [2, 3, 'Maintaining'],
  [3, 4, 'Improving'],
  [4, 5, 'Highly improving'],
  [5, 9, 'Overreaching'],
];

export const teLabel = (v: number): string => (TE_BANDS.find(b => v >= b[0] && v < b[1]) ?? TE_BANDS[0])[2];

export const TE_SCALE_TEXT =
  "Garmin's 0–5 scale: under 1 no benefit, 1–1.9 minor, 2–2.9 maintaining, 3–3.9 improving, 4–4.9 highly improving, 5 overreaching";

/** Paces read better than speeds for foot sports and swimming. */
export const usesPace = (fam: Family): boolean => fam === 'run' || fam === 'walk' || fam === 'swim';
