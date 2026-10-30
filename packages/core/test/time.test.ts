import { describe, expect, it } from 'vitest';
import { binSpan, dayKey, fmtSpan } from '../src/index.ts';

const d = (s: string): Date => new Date(`${s}T00:00:00`);
// Thursday 5 Nov 2026; its week runs Mon 2 – Sun 8 Nov.
const TODAY = d('2026-11-05');
const TOMORROW = d('2026-11-06');

const span = (start: string, end: string, from: string, to: Date | string) => {
  const s = binSpan(d(start), d(end), d(from), typeof to === 'string' ? d(to) : to, TODAY);
  return { ...s, first: dayKey(s.first), last: dayKey(s.last) };
};

describe('binSpan', () => {
  it('counts a whole week inside the window', () => {
    expect(span('2026-10-20', '2026-10-27', '2026-10-01', TOMORROW)).toMatchObject({
      first: '2026-10-20', last: '2026-10-26', days: 7, totalDays: 7, full: true, startsLate: false, endsEarly: false, inProgress: false,
    });
  });

  it('clips the first week to the start of the range', () => {
    expect(span('2026-09-28', '2026-10-05', '2026-10-01', TOMORROW)).toMatchObject({
      first: '2026-10-01', last: '2026-10-04', days: 4, full: false, startsLate: true, inProgress: false,
    });
  });

  it('marks the current week as in progress up to today', () => {
    expect(span('2026-11-02', '2026-11-09', '2026-10-01', TOMORROW)).toMatchObject({
      first: '2026-11-02', last: '2026-11-05', days: 4, full: false, startsLate: false, endsEarly: false, inProgress: true,
    });
  });

  it('treats a week that ends today as complete', () => {
    const sunday = binSpan(d('2026-11-02'), d('2026-11-09'), d('2026-10-01'), d('2026-11-09'), d('2026-11-08'));
    expect(sunday).toMatchObject({ days: 7, full: true, inProgress: false });
  });

  it('clips the last week to the end of a custom range in the past', () => {
    expect(span('2026-10-12', '2026-10-19', '2026-10-01', '2026-10-15')).toMatchObject({
      first: '2026-10-12', last: '2026-10-14', days: 3, endsEarly: true, inProgress: false,
    });
  });

  it('handles a range shorter than a week', () => {
    expect(span('2026-11-02', '2026-11-09', '2026-11-04', TOMORROW)).toMatchObject({
      first: '2026-11-04', last: '2026-11-05', days: 2, startsLate: true, inProgress: true,
    });
  });

  it('clips months the same way', () => {
    expect(span('2026-11-01', '2026-12-01', '2026-01-01', TOMORROW)).toMatchObject({
      first: '2026-11-01', last: '2026-11-05', days: 5, totalDays: 30, inProgress: true,
    });
  });
});

describe('fmtSpan', () => {
  it('names weekdays and the year once', () => expect(fmtSpan(d('2026-10-27'), d('2026-11-02'))).toBe('Tue 27 Oct – Mon 2 Nov 2026'));
  it('shows both years across New Year', () => expect(fmtSpan(d('2025-12-29'), d('2026-01-04'))).toBe('Mon 29 Dec 2025 – Sun 4 Jan 2026'));
  it('shows a single day once', () => expect(fmtSpan(d('2026-11-05'), d('2026-11-05'))).toBe('Thu 5 Nov 2026'));
});
