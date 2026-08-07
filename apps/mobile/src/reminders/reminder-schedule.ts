/**
 * Reminder planning is a pure function so the two awkward parts — daylight
 * saving and the old-zone/new-zone handover of a pending account time-zone
 * change — are testable without a notification runtime or a device clock.
 *
 * iOS has no "repeat daily in this IANA zone" trigger, so V1 schedules a
 * bounded run of one-shots and refreshes them at launch (spec section 3.5).
 */

const millisecondsPerMinute = 60_000;
const millisecondsPerDay = 86_400_000;

/** iOS keeps at most 64 pending local notifications; two weeks stays well under. */
export const defaultReminderHorizonDays = 14;

/**
 * Around a handover the old zone and the new zone can each produce an
 * occurrence within the same stretch of a day. The earlier one wins and
 * anything closer than this to it is dropped, so nobody is reminded twice.
 */
const minimumSpacingMs = 12 * 3_600_000;

export interface ReminderScheduleInput {
  accountTimeZone: string;
  /** Days of one-shots to plan ahead. Defaults to {@link defaultReminderHorizonDays}. */
  horizonDays?: number;
  now: Date;
  pendingTimeZone?: string | null;
  reminderEnabled: boolean;
  /** Minutes after local midnight, matching `UserPreferences.reminderLocalMinutes`. */
  reminderLocalMinutes: number;
  timeZoneEffectiveAt?: Date | string | null;
}

export interface ScheduledReminder {
  fireAt: Date;
  /** The zone whose wall clock produced this instant. */
  timeZone: string;
}

interface LocalDate {
  day: number;
  month: number;
  year: number;
}

interface WallClock extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function getPartFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory',
      day: '2-digit',
      hour: '2-digit',
      // h23 is explicit because `hour12: false` still renders midnight as "24"
      // under some ICU builds.
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      numberingSystem: 'latn',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    getPartFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClockAt(instantMs: number, timeZone: string): WallClock {
  const values = new Map(
    getPartFormatter(timeZone)
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value]),
  );
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(values.get(type));
    if (!Number.isInteger(value)) {
      throw new RangeError(`Could not resolve the local ${type} in ${timeZone}.`);
    }
    return value;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Milliseconds the zone runs ahead of UTC at this instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  // Intl reports whole seconds, so the comparison instant is floored to match.
  const flooredMs = Math.floor(instantMs / 1_000) * 1_000;
  const wall = wallClockAt(flooredMs, timeZone);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - flooredMs
  );
}

/**
 * Resolves a local wall-clock time to an instant. A time that never happens
 * (spring forward) rolls forward past the gap, and one that happens twice
 * (fall back) takes the first occurrence — what a person expects of a daily
 * reminder in both cases.
 */
function instantForLocalTime(
  date: LocalDate,
  minutesAfterMidnight: number,
  timeZone: string,
): Date {
  const wallAsUtcMs =
    Date.UTC(date.year, date.month - 1, date.day) + minutesAfterMidnight * millisecondsPerMinute;
  const candidates = [
    wallAsUtcMs - zoneOffsetMs(wallAsUtcMs - millisecondsPerDay, timeZone),
    wallAsUtcMs - zoneOffsetMs(wallAsUtcMs + millisecondsPerDay, timeZone),
  ];
  const valid = candidates.filter(
    (candidate) => wallAsUtcMs - zoneOffsetMs(candidate, timeZone) === candidate,
  );
  return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(...candidates));
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function occurrencesIn(
  timeZone: string,
  nowMs: number,
  horizonDays: number,
  minutesAfterMidnight: number,
): ScheduledReminder[] {
  const startDate = wallClockAt(nowMs, timeZone);
  const occurrences: ScheduledReminder[] = [];
  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
    occurrences.push({
      fireAt: instantForLocalTime(addDays(startDate, dayOffset), minutesAfterMidnight, timeZone),
      timeZone,
    });
  }
  return occurrences;
}

function resolveInstant(value: Date | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.getTime() : undefined;
}

export function planReminderSchedule(input: ReminderScheduleInput): ScheduledReminder[] {
  if (!input.reminderEnabled) {
    return [];
  }
  if (!Number.isInteger(input.reminderLocalMinutes)) {
    throw new RangeError('reminderLocalMinutes must be a whole number of minutes.');
  }
  const horizonDays = input.horizonDays ?? defaultReminderHorizonDays;
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs) || horizonDays < 1) {
    return [];
  }
  const minutes = ((input.reminderLocalMinutes % 1_440) + 1_440) % 1_440;

  // A pending change splits the schedule only when both halves are usable; the
  // server always reports the zone and its effective instant together.
  const handover = resolveHandover(input);

  const candidates =
    handover === undefined
      ? occurrencesIn(input.accountTimeZone, nowMs, horizonDays, minutes)
      : [
          ...occurrencesIn(input.accountTimeZone, nowMs, horizonDays, minutes).filter(
            (occurrence) => occurrence.fireAt.getTime() < handover.atMs,
          ),
          ...occurrencesIn(handover.timeZone, nowMs, horizonDays, minutes).filter(
            (occurrence) => occurrence.fireAt.getTime() >= handover.atMs,
          ),
        ];

  const schedule: ScheduledReminder[] = [];
  for (const candidate of candidates
    .filter((occurrence) => occurrence.fireAt.getTime() > nowMs)
    .sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime())) {
    const previous = schedule.at(-1);
    if (
      previous !== undefined &&
      candidate.fireAt.getTime() - previous.fireAt.getTime() < minimumSpacingMs
    ) {
      continue;
    }
    schedule.push(candidate);
    if (schedule.length === horizonDays) {
      break;
    }
  }
  return schedule;
}

function resolveHandover(
  input: ReminderScheduleInput,
): { atMs: number; timeZone: string } | undefined {
  const timeZone = input.pendingTimeZone;
  const atMs = resolveInstant(input.timeZoneEffectiveAt);
  if (
    timeZone === null ||
    timeZone === undefined ||
    timeZone === input.accountTimeZone ||
    atMs === undefined ||
    !isSupportedTimeZone(timeZone)
  ) {
    return undefined;
  }
  return { atMs, timeZone };
}

/** Renders `reminderLocalMinutes` the way the settings row states it. */
export function formatReminderTime(reminderLocalMinutes: number): string {
  const minutes = ((Math.trunc(reminderLocalMinutes) % 1_440) + 1_440) % 1_440;
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12)}:${String(minutes % 60).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}
