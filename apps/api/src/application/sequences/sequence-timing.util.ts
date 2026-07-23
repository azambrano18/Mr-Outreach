import { DelayUnit } from '../../domain/sequence/sequence-step.entity';
import { SequenceSchedule } from '../../domain/sequence/sequence.entity';

export const SANTIAGO_TIMEZONE = 'America/Santiago';

/** §5 — "Gestión_DDMMYYYY", from a YYYY-MM-DD calendar date (no time-of-day/timezone involved). */
export function generateSequenceName(managementDate: string): string {
  const [year, month, day] = managementDate.split('-');
  return `Gestión_${day}${month}${year}`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay(). */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_CODE = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Reads an instant's wall-clock date/time/weekday AS SEEN IN `timezone`, via `Intl` — no date library needed. */
function zonedParts(instant: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
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
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

/** How many minutes ahead of UTC `timezone`'s wall clock reads at `instant` (e.g. Santiago: -180 in verano/DST, -240 in invierno). */
function offsetMinutes(instant: Date, timezone: string): number {
  const p = zonedParts(instant, timezone);
  const asUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtcMs - instant.getTime()) / 60_000);
}

/** Inverse of `zonedParts` — the real UTC instant that reads as the given wall-clock date/time in `timezone`, correctly handling DST (never a fixed UTC-4 offset). */
function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetMinutes(new Date(naiveUtcMs), timezone);
  return new Date(naiveUtcMs - offset * 60_000);
}

/** Pure calendar-date weekday (0=Sun..6=Sat) — timezone-independent by construction, since y/m/d alone fully determine it. */
function calendarWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  amount: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + amount);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function parseWindowTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

/** Following Monday's date when `year/month/day` falls on a Saturday(6) or Sunday(0); the same date otherwise. */
function skipToMonday(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const weekday = calendarWeekday(year, month, day);
  if (weekday === 0) return addCalendarDays(year, month, day, 1);
  if (weekday === 6) return addCalendarDays(year, month, day, 2);
  return { year, month, day };
}

/**
 * §6 — "Inicio de la secuencia":
 *  - fecha de gestión = hoy y se publica dentro del horario -> inicia de inmediato.
 *  - fecha futura -> 08:00 (inicio de la ventana) de ese día.
 *  - se publica fuera del horario -> siguiente ventana disponible.
 *  - fecha en sábado/domingo -> el lunes siguiente a las 08:00.
 */
export function computeEffectiveStart(
  managementDate: string,
  requestedAt: Date,
  sendingWindow: SequenceSchedule,
  timezone: string,
): Date {
  const window = sendingWindow.windows[0] ?? { start: '08:00', end: '19:00' };
  const { hour: startH, minute: startMin } = parseWindowTime(window.start);
  const { hour: endH, minute: endMin } = parseWindowTime(window.end);

  const requestedDate = parseIsoDate(managementDate);
  const weekday = calendarWeekday(requestedDate.year, requestedDate.month, requestedDate.day);

  if (weekday === 0 || weekday === 6) {
    const monday = skipToMonday(requestedDate.year, requestedDate.month, requestedDate.day);
    return zonedTimeToInstant(monday.year, monday.month, monday.day, startH, startMin, timezone);
  }

  const now = zonedParts(requestedAt, timezone);
  const isManagementDateToday =
    now.year === requestedDate.year && now.month === requestedDate.month && now.day === requestedDate.day;

  if (!isManagementDateToday) {
    // Future management date (past dates, which the wizard shouldn't allow, fall back to the same "start at window open" rule).
    return zonedTimeToInstant(requestedDate.year, requestedDate.month, requestedDate.day, startH, startMin, timezone);
  }

  const nowMinutes = now.hour * 60 + now.minute;
  const startMinutes = startH * 60 + startMin;
  const endMinutes = endH * 60 + endMin;

  if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
    return requestedAt;
  }
  if (nowMinutes < startMinutes) {
    return zonedTimeToInstant(requestedDate.year, requestedDate.month, requestedDate.day, startH, startMin, timezone);
  }

  // Published after the window closed today -> next allowed weekday at window open.
  const nextDay = addCalendarDays(requestedDate.year, requestedDate.month, requestedDate.day, 1);
  const resolved = skipToMonday(nextDay.year, nextDay.month, nextDay.day);
  return zonedTimeToInstant(resolved.year, resolved.month, resolved.day, startH, startMin, timezone);
}

/**
 * §12 — "el plazo debe calcularse desde el envío efectivo del step anterior": advances `instant`
 * by `businessDays` full business days (Mon-Fri, no holiday calendar in this first version),
 * preserving the original time-of-day in `timezone`.
 */
export function addBusinessDays(instant: Date, businessDays: number, timezone: string): Date {
  const parts = zonedParts(instant, timezone);
  let { year, month, day } = parts;
  let remaining = businessDays;
  while (remaining > 0) {
    ({ year, month, day } = addCalendarDays(year, month, day, 1));
    const weekday = calendarWeekday(year, month, day);
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return zonedTimeToInstant(year, month, day, parts.hour, parts.minute, timezone);
}

export function weekdayCode(instant: Date, timezone: string): string {
  return WEEKDAY_CODE[zonedParts(instant, timezone).weekday];
}

/** §7 — "envío estimado": advances `instant` by a step's own delay, in whichever unit it uses (business-day-aware for BUSINESS_DAYS, plain elapsed time otherwise). Shared by SchedulingService's real scheduling math and the wizard's estimate preview, so the two can never drift apart. */
export function addDelay(instant: Date, value: number, unit: DelayUnit, timezone: string): Date {
  if (unit === 'BUSINESS_DAYS') return addBusinessDays(instant, value, timezone);
  const msPerUnit = unit === 'MINUTES' ? 60_000 : unit === 'HOURS' ? 3_600_000 : 86_400_000;
  return new Date(instant.getTime() + value * msPerUnit);
}
