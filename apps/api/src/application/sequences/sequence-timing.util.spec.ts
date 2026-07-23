import { addBusinessDays, computeEffectiveStart, generateSequenceName, SANTIAGO_TIMEZONE } from './sequence-timing.util';
import { SequenceSchedule } from '../../domain/sequence/sequence.entity';

const WINDOW: SequenceSchedule = {
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  windows: [{ start: '08:00', end: '19:00' }],
};

function santiagoWallClock(instant: Date): { date: string; time: string; weekday: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTIAGO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) map[part.type] = part.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, weekday: map.weekday };
}

describe('generateSequenceName', () => {
  it('formats Gestión_DDMMYYYY from a YYYY-MM-DD calendar date', () => {
    expect(generateSequenceName('2026-07-20')).toBe('Gestión_20072026');
    expect(generateSequenceName('2026-01-05')).toBe('Gestión_05012026');
  });
});

describe('computeEffectiveStart', () => {
  it('starts immediately when publishing today within the sending window', () => {
    // 2026-07-20 is a Monday; 14:30 Santiago time is well inside 08:00-19:00.
    const requestedAt = new Date(`2026-07-20T18:30:00.000Z`); // ~14:30-15:30 Santiago depending on DST
    const result = computeEffectiveStart('2026-07-20', requestedAt, WINDOW, SANTIAGO_TIMEZONE);
    expect(result.getTime()).toBe(requestedAt.getTime());
  });

  it('starts today at the window open time when published before the window opens', () => {
    const requestedAt = new Date('2026-07-20T05:00:00.000Z'); // pre-dawn UTC, before 08:00 Santiago either way
    const result = computeEffectiveStart('2026-07-20', requestedAt, WINDOW, SANTIAGO_TIMEZONE);
    const wall = santiagoWallClock(result);
    expect(wall.date).toBe('2026-07-20');
    expect(wall.time).toBe('08:00');
  });

  it('rolls over to the next weekday at window open when published after the window closes', () => {
    const requestedAt = new Date('2026-07-20T23:30:00.000Z'); // after 19:00 Santiago either way
    const result = computeEffectiveStart('2026-07-20', requestedAt, WINDOW, SANTIAGO_TIMEZONE);
    const wall = santiagoWallClock(result);
    expect(wall.date).toBe('2026-07-21');
    expect(wall.time).toBe('08:00');
  });

  it('starts a future management date at 08:00 that day', () => {
    const requestedAt = new Date('2026-07-15T15:00:00.000Z');
    const result = computeEffectiveStart('2026-07-20', requestedAt, WINDOW, SANTIAGO_TIMEZONE);
    const wall = santiagoWallClock(result);
    expect(wall.date).toBe('2026-07-20');
    expect(wall.time).toBe('08:00');
  });

  it('moves a Saturday/Sunday management date to the following Monday at 08:00', () => {
    // 2026-07-18 is a Saturday.
    const requestedAt = new Date('2026-07-16T15:00:00.000Z');
    const result = computeEffectiveStart('2026-07-18', requestedAt, WINDOW, SANTIAGO_TIMEZONE);
    const wall = santiagoWallClock(result);
    expect(wall.date).toBe('2026-07-20'); // the following Monday
    expect(wall.time).toBe('08:00');
    expect(wall.weekday).toBe('Mon');
  });
});

describe('addBusinessDays', () => {
  it('skips weekends and preserves the time of day', () => {
    // 2026-07-20 (Monday) 10:15 Santiago + 5 business days -> the following Monday 2026-07-27.
    const sentAt = new Date('2026-07-20T14:15:00.000Z');
    const result = addBusinessDays(sentAt, 5, SANTIAGO_TIMEZONE);
    const wall = santiagoWallClock(result);
    expect(wall.weekday).not.toBe('Sat');
    expect(wall.weekday).not.toBe('Sun');
    expect(wall.date).toBe('2026-07-27');
  });

  it('never lands on a Saturday or Sunday', () => {
    const sentAt = new Date('2026-07-20T14:15:00.000Z');
    for (let n = 1; n <= 15; n += 1) {
      const result = addBusinessDays(sentAt, n, SANTIAGO_TIMEZONE);
      const wall = santiagoWallClock(result);
      expect(['Sat', 'Sun']).not.toContain(wall.weekday);
    }
  });
});
