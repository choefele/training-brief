import { fmtInt, fmtMMSS } from './time.ts';
import type { Activity } from './types.ts';

export type UnitSystem = 'metric' | 'imperial';

export interface Units {
  system: UnitSystem;
  /** Metres per distance unit. */
  dist: number;
  distL: string;
  /** Metres per elevation unit. */
  elev: number;
  elevL: string;
  /** Factor from m/s. */
  speed: number;
  speedL: string;
  paceL: string;
  /** Metres per swim pace unit. */
  swim: number;
  swimL: string;
}

export const UNITS: Record<UnitSystem, Units> = {
  metric: { system: 'metric', dist: 1000, distL: 'km', elev: 1, elevL: 'm', speed: 3.6, speedL: 'km/h', paceL: '/km', swim: 100, swimL: '/100 m' },
  imperial: { system: 'imperial', dist: 1609.344, distL: 'mi', elev: 0.3048, elevL: 'ft', speed: 2.236936, speedL: 'mph', paceL: '/mi', swim: 91.44, swimL: '/100 yd' },
};

export const unitsFor = (system: UnitSystem): Units => UNITS[system] ?? UNITS.metric;

export const fmtDistance = (m: number | null | undefined, u: Units, dp = 1): string => (m == null ? '–' : (m / u.dist).toFixed(dp));
export const fmtElevation = (m: number | null | undefined, u: Units): string => (m == null ? '–' : fmtInt(m / u.elev));

/** Pace for runs, walks and swims; speed for everything else. */
export function paceOrSpeed(a: Pick<Activity, 'dist' | 'dur' | 'fam'>, u: Units, withUnit = true): string {
  if (!a.dist || !a.dur) return '–';
  if (a.fam === 'swim') return fmtMMSS(a.dur / (a.dist / u.swim)) + (withUnit ? ' ' + u.swimL : '');
  if (a.fam === 'run' || a.fam === 'walk') return fmtMMSS(a.dur / (a.dist / u.dist)) + (withUnit ? ' ' + u.paceL : '');
  return ((a.dist / a.dur) * u.speed).toFixed(1) + (withUnit ? ' ' + u.speedL : '');
}

/** One line that tells an assistant how to read every number in an export. */
export const unitLine = (u: Units): string =>
  `distance ${u.distL}; elevation ${u.elevL}; time h:mm:ss; running and walking pace min:ss ${u.paceL}; swim pace min:ss ${u.swimL}; cycling and other speeds ${u.speedL}; heart rate bpm; power W`;
