import { addDays, dayKey, pad, startOfDay, weekdayIndex } from './time.ts';
import type { GarminActivity } from './types.ts';

/**
 * Made-up activities shaped like the Personal API's search results: 240 days of runs, rides,
 * swims, strength sessions and hikes for one athlete building towards a half marathon.
 * Deterministic for a given `today`. Never label this data as coming from Garmin.
 */
export function makeSampleActivities(today: Date = new Date(), days = 240): GarminActivity[] {
  let seed = 20261029;
  const R = (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = (a: number, b: number): number => a + (b - a) * R();
  const pick = <T>(arr: T[]): T => arr[Math.floor(R() * arr.length)];
  const chance = (p: number): boolean => R() < p;

  const TYPES: Record<string, [number, number]> = {
    running: [1, 17], trail_running: [6, 1], treadmill_running: [18, 1], road_biking: [10, 2], indoor_cycling: [25, 2],
    lap_swimming: [27, 26], strength_training: [13, 29], hiking: [3, 17], walking: [9, 17],
  };
  const EVENTS: Record<string, number> = { race: 1, training: 4, uncategorized: 9, recreation: 5 };
  const NOTES = ['Legs heavy from Saturday.', 'Felt strong, negative split.', 'Windy along the river.', 'Hot, took it easy.', 'New shoes, first run.', 'Slight niggle in left calf.', 'Group ride, good pace.', 'Drills: catch-up and kick sets.', ''];

  interface Spec {
    name: string; dur: number; hr: number; aer: number; ana: number; cal: number;
    loc?: string; dist?: number; elev?: number; maxHR?: number; tss?: number; vo2?: number; cad?: number;
    pw?: number; np?: number; rpm?: number; swolf?: number; lengths?: number; event?: string; pr?: boolean; fav?: boolean; desc?: string;
  }

  const out: GarminActivity[] = [];
  let id = 17200000000;
  const base = startOfDay(today);
  const fmtLocal = (d: Date): string => `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const mk = (date: Date, hour: number, key: string, f: Spec): void => {
    const d = new Date(date);
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), Math.floor(R() * 60));
    const [typeId, parentTypeId] = TYPES[key];
    const ev = f.event || (chance(0.5) ? 'training' : 'uncategorized');
    const outdoors = !['indoor_cycling', 'lap_swimming', 'strength_training', 'treadmill_running'].includes(key);
    const inBerlin = f.loc === 'Berlin' || !f.loc;
    out.push({
      activityId: (id += Math.floor(rnd(9e4, 4e5))),
      activityName: f.name,
      description: f.desc ?? (chance(0.18) ? pick(NOTES) : ''),
      startTimeLocal: fmtLocal(d),
      startTimeGMT: d.toISOString().slice(0, 19).replace('T', ' '),
      beginTimestamp: d.getTime(),
      activityType: { typeId, typeKey: key, parentTypeId },
      eventType: { typeId: EVENTS[ev], typeKey: ev },
      distance: f.dist ?? null,
      duration: f.dur,
      elapsedDuration: Math.round(f.dur * rnd(1.01, 1.08)),
      movingDuration: f.dur,
      elevationGain: f.elev ?? null,
      elevationLoss: f.elev != null ? Math.round(f.elev * rnd(0.92, 1.05)) : null,
      averageSpeed: f.dist ? +(f.dist / f.dur).toFixed(3) : null,
      maxSpeed: f.dist ? +((f.dist / f.dur) * rnd(1.25, 1.7)).toFixed(3) : null,
      calories: Math.round(f.cal),
      averageHR: Math.round(f.hr),
      maxHR: Math.round(f.maxHR ?? f.hr * rnd(1.08, 1.16)),
      aerobicTrainingEffect: +f.aer.toFixed(1),
      anaerobicTrainingEffect: +f.ana.toFixed(1),
      trainingStressScore: f.tss != null ? +f.tss.toFixed(1) : null,
      vO2MaxValue: f.vo2 ?? null,
      averageRunningCadenceInStepsPerMinute: f.cad ?? null,
      steps: f.cad ? Math.round((f.cad * f.dur) / 60) : null,
      avgPower: f.pw ?? null,
      normPower: f.np ?? null,
      averageBikingCadenceInRevPerMinute: f.rpm ?? null,
      averageSwolf: f.swolf ?? null,
      activeLengths: f.lengths ?? null,
      poolLength: f.lengths ? 2500 : null,
      locationName: f.loc ?? 'Berlin',
      isFavorite: f.fav ?? chance(0.04),
      isPR: !!f.pr,
      hasPolyline: outdoors,
      startLatitude: inBerlin ? +rnd(52.45, 52.56).toFixed(5) : null,
      startLongitude: inBerlin ? +rnd(13.25, 13.5).toFixed(5) : null,
      ownerDisplayName: 'sample-athlete',
      manualActivity: false,
    });
  };

  const hrTSS = (dur: number, hr: number): number => (dur / 3600) * Math.pow(hr / 168, 2) * 100;
  const powerTSS = (dur: number, np: number): number => (dur / 3600) * Math.pow(np / 250, 2) * 100;

  const run = (date: Date, kind: string, prog: number, scale: number): void => {
    let km = 0, pace = 0, hr = 0, aer = 0, ana = 0, key = 'running', elevPerKm = rnd(3, 11), name = '', loc = 'Berlin';
    let extra: Partial<Spec> = {};
    if (kind === 'easy') {
      km = rnd(6, 10) * scale; pace = rnd(325, 350) - 20 * prog; hr = rnd(136, 147) - 3 * prog; aer = rnd(2.4, 3.2); ana = rnd(0, 0.8);
      name = chance(0.6) ? 'Berlin Running' : pick(['Easy run', 'Recovery jog', 'Easy run along the Spree']);
      if (chance(0.1)) { key = 'treadmill_running'; name = 'Treadmill Running'; elevPerKm = 0; loc = ''; }
    }
    if (kind === 'int') {
      km = rnd(8, 11) * scale; pace = rnd(292, 310) - 18 * prog; hr = rnd(152, 161); aer = rnd(3.4, 4.3); ana = rnd(2.0, 3.2);
      name = pick(['Intervals 6×800 m', 'Tempo 3×10 min', 'Track 10×400 m', 'Hill repeats 8×60 s', 'Threshold 2×20 min']);
      extra.maxHR = rnd(176, 184);
    }
    if (kind === 'long') {
      km = (rnd(15, 20) + 5 * prog) * scale; pace = rnd(335, 352) - 15 * prog; hr = rnd(143, 151); aer = rnd(3.3, 4.1); ana = rnd(0.2, 1.2);
      name = pick(['Long run', 'Sunday long run', 'Long run to Wannsee', 'Long run, last 3 km at goal pace']);
    }
    if (kind === 'trail') {
      km = rnd(14, 21) * scale; pace = rnd(400, 455); hr = rnd(142, 152); aer = rnd(3.2, 4.0); ana = rnd(0.3, 1.4);
      key = 'trail_running'; elevPerKm = rnd(28, 45); name = pick(['Grunewald trails', 'Teufelsberg loops', 'Müggelberge trail run']);
    }
    if (kind === '10k') {
      km = 10.02; pace = 263; hr = 172; aer = 4.6; ana = 3.1; name = 'Berlin City 10K';
      extra = { event: 'race', pr: true, maxHR: 186, fav: true, desc: 'Race. Even pacing, kicked from 8 km.' };
    }
    if (kind === 'hm') {
      km = 21.12; pace = 281; hr = 168; aer = 4.9; ana = 2.4; name = 'Potsdam Half Marathon'; loc = 'Potsdam';
      extra = { event: 'race', pr: true, maxHR: 183, fav: true, desc: 'Goal race. Faded a little after 17 km.' };
    }
    const dur = km * pace;
    mk(date, kind === 'int' ? 18.25 : kind === 'easy' ? (chance(0.5) ? 6.75 : 18) : 9, key, {
      name, loc, dist: Math.round(km * 1000), dur: Math.round(dur), elev: Math.round(km * elevPerKm), hr, aer, ana, cal: km * rnd(64, 72),
      tss: hrTSS(dur, hr), vo2: Math.round(50 + 3 * prog + (kind === 'int' || kind === '10k' ? 1 : 0)), cad: Math.round(rnd(166, 176)), ...extra,
    });
  };

  for (let back = days; back >= 1; back--) {
    const date = addDays(base, -back), dow = weekdayIndex(date), prog = 1 - back / days;
    const recovery = Math.floor(back / 7) % 4 === 0, scale = recovery ? 0.75 : 1;
    if (back === 12) { run(date, 'hm', prog, 1); continue; }
    if (back === 68) { run(date, '10k', prog, 1); continue; }
    if (back === 11 || back === 69) continue;
    if (chance(recovery ? 0.3 : 0.12)) continue;
    switch (dow) {
      case 0:
        if (chance(0.6)) mk(date, 19, 'strength_training', { name: pick(['Strength – lower body', 'Strength – upper body', 'Core & mobility']), loc: '', dur: Math.round(rnd(40, 60) * 60), hr: rnd(108, 124), aer: rnd(1.2, 2.2), ana: rnd(0.8, 1.8), cal: rnd(250, 400) });
        break;
      case 1:
        run(date, 'int', prog, scale);
        break;
      case 2:
        if (chance(0.5)) {
          const dur = Math.round(rnd(45, 75) * 60 * scale), pw = rnd(178, 205) + 18 * prog, np = pw * rnd(1.04, 1.09);
          mk(date, 18.5, 'indoor_cycling', { name: pick(['Indoor Cycling', 'Zwift – sweet spot 3×12', 'Indoor endurance ride']), loc: '', dist: Math.round(dur * rnd(8.2, 9.3)), dur, hr: rnd(134, 149), aer: rnd(2.8, 3.8), ana: rnd(0.4, 1.6), cal: (dur / 60) * rnd(10, 12), pw: Math.round(pw), np: Math.round(np), rpm: Math.round(rnd(84, 94)), tss: powerTSS(dur, np) });
        } else {
          const km = rnd(35, 55) * scale, v = rnd(26.5, 29.5) / 3.6, dur = Math.round((km * 1000) / v), pw = rnd(165, 190), np = pw * 1.08;
          mk(date, 17.75, 'road_biking', { name: 'Berlin Road Cycling', dist: Math.round(km * 1000), dur, elev: Math.round(km * rnd(4, 9)), hr: rnd(132, 146), aer: rnd(2.6, 3.4), ana: rnd(0.2, 1.1), cal: (dur / 60) * rnd(9, 11), pw: Math.round(pw), np: Math.round(np), rpm: Math.round(rnd(82, 90)), tss: powerTSS(dur, np) });
        }
        break;
      case 3:
        run(date, 'easy', prog, scale);
        if (chance(0.3)) mk(date, 19.5, 'strength_training', { name: 'Core & mobility', loc: '', dur: Math.round(rnd(25, 35) * 60), hr: rnd(100, 115), aer: rnd(0.8, 1.5), ana: rnd(0.3, 1), cal: rnd(140, 220) });
        break;
      case 4:
        if (chance(0.75)) {
          const m = Math.round(rnd(30, 60) * scale) * 50, p100 = rnd(112, 124) - 6 * prog, dur = Math.round((m / 100) * p100);
          mk(date, 7, 'lap_swimming', { name: pick(['Pool Swim', 'Pool – technique', 'Pool – 10×100 m', 'Pool Swim']), loc: 'Berlin', dist: m, dur, hr: rnd(124, 140), aer: rnd(2.2, 3.3), ana: rnd(0.3, 1.5), cal: (dur / 60) * rnd(8, 10), swolf: Math.round(rnd(36, 44) - 2 * prog), lengths: m / 25 });
        }
        break;
      case 5:
        if (chance(0.25)) {
          const km = rnd(9, 18), v = rnd(4, 4.6) / 3.6, dur = Math.round((km * 1000) / v);
          mk(date, 9.5, 'hiking', { name: pick(['Sächsische Schweiz hike', 'Harz hike', 'Fläming hike']), loc: pick(['Bad Schandau', 'Wernigerode', 'Bad Belzig']), dist: Math.round(km * 1000), dur, elev: Math.round(rnd(400, 1150)), hr: rnd(108, 124), aer: rnd(1.6, 2.6), ana: rnd(0, 0.4), cal: (dur / 60) * rnd(6, 8) });
        } else {
          const km = (rnd(60, 95) + 20 * prog) * scale, v = rnd(26, 29.5) / 3.6, dur = Math.round((km * 1000) / v), pw = rnd(162, 188), np = pw * 1.09;
          mk(date, 9, 'road_biking', { name: pick(['Ride to Potsdam and back', 'Saturday group ride', 'Long ride – Oder loop', 'Havel lakes loop']), loc: pick(['Berlin', 'Potsdam']), dist: Math.round(km * 1000), dur, elev: Math.round(km * rnd(5, 13)), hr: rnd(134, 146), aer: rnd(3.1, 4.0), ana: rnd(0.3, 1.5), cal: (dur / 60) * rnd(9.5, 11.5), pw: Math.round(pw), np: Math.round(np), rpm: Math.round(rnd(82, 90)), tss: powerTSS(dur, np) });
        }
        break;
      case 6:
        run(date, chance(0.2) ? 'trail' : 'long', prog, scale);
        if (chance(0.15)) {
          const km = rnd(3, 6), dur = Math.round((km * 1000) / (5 / 3.6));
          mk(date, 16, 'walking', { name: 'Berlin Walking', dist: Math.round(km * 1000), dur, elev: Math.round(km * 4), hr: rnd(92, 104), aer: rnd(0.4, 1), ana: 0, cal: (dur / 60) * 4.5 });
        }
        break;
    }
  }
  return out;
}
