const millisecondsPerHour = 3_600_000;
const timeZoneChangeWindowMs = 168 * millisecondsPerHour;
const searchStepMs = 36 * millisecondsPerHour;
const maximumSearchSteps = 6;

interface LocalDate {
  day: number;
  month: number;
  year: number;
}

export interface AccountDayBounds {
  nextResetAt: Date;
  startedAt: Date;
  timeZone: string;
}

export interface MaterialTimeZoneChange {
  nextTimeZoneChangeEligibleAt: Date;
  requestedTimeZone: string;
  timeZoneEffectiveAt: Date;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory',
      day: '2-digit',
      month: '2-digit',
      numberingSystem: 'latn',
      timeZone,
      year: 'numeric',
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function assertValidInstant(value: Date, name: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid instant.`);
  }
}

function localDateAt(instantMs: number, timeZone: string): LocalDate {
  const parts = getDateFormatter(timeZone).formatToParts(new Date(instantMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get('year'));
  const month = Number(values.get('month'));
  const day = Number(values.get('day'));
  if (![year, month, day].every(Number.isInteger)) {
    throw new RangeError(`Could not resolve a calendar date for ${timeZone}.`);
  }
  return { year, month, day };
}

function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function followingCalendarDate(date: LocalDate): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function findFirstInstantOnOrAfterLocalDate(
  knownEarlierMs: number,
  knownAtOrAfterMs: number,
  target: LocalDate,
  timeZone: string,
): Date {
  let low = knownEarlierMs;
  let high = knownAtOrAfterMs;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (compareLocalDates(localDateAt(middle, timeZone), target) >= 0) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return new Date(high);
}

function findStartOfLocalDate(nowMs: number, target: LocalDate, timeZone: string): Date {
  let earlier = nowMs - searchStepMs;
  let attempts = 0;
  while (compareLocalDates(localDateAt(earlier, timeZone), target) >= 0) {
    attempts += 1;
    if (attempts > maximumSearchSteps) {
      throw new RangeError(`Could not find the start of the account day in ${timeZone}.`);
    }
    earlier -= searchStepMs;
  }
  return findFirstInstantOnOrAfterLocalDate(earlier, nowMs, target, timeZone);
}

function findStartOfFollowingLocalDate(nowMs: number, target: LocalDate, timeZone: string): Date {
  let later = nowMs + searchStepMs;
  let attempts = 0;
  while (compareLocalDates(localDateAt(later, timeZone), target) < 0) {
    attempts += 1;
    if (attempts > maximumSearchSteps) {
      throw new RangeError(`Could not find the next account day in ${timeZone}.`);
    }
    later += searchStepMs;
  }
  return findFirstInstantOnOrAfterLocalDate(nowMs, later, target, timeZone);
}

export function canonicalizeIanaTimeZone(reportedTimeZone: string): string {
  const trimmed = reportedTimeZone.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new RangeError('The time zone must be a nonempty IANA identifier.');
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch (error) {
    throw new RangeError('The time zone must be a recognized IANA identifier.', { cause: error });
  }
}

export function getAccountDayBounds(now: Date, timeZoneInput: string): AccountDayBounds {
  assertValidInstant(now, 'now');
  const timeZone = canonicalizeIanaTimeZone(timeZoneInput);
  const nowMs = now.getTime();
  const currentDate = localDateAt(nowMs, timeZone);
  const nextDate = followingCalendarDate(currentDate);
  return {
    startedAt: findStartOfLocalDate(nowMs, currentDate, timeZone),
    nextResetAt: findStartOfFollowingLocalDate(nowMs, nextDate, timeZone),
    timeZone,
  };
}

export function planMaterialTimeZoneChange(options: {
  currentPeriodResetAt: Date;
  now: Date;
  requestedTimeZone: string;
}): MaterialTimeZoneChange {
  assertValidInstant(options.currentPeriodResetAt, 'currentPeriodResetAt');
  assertValidInstant(options.now, 'now');
  if (options.currentPeriodResetAt <= options.now) {
    throw new RangeError('The current period reset must be in the future.');
  }
  const requestedBounds = getAccountDayBounds(options.now, options.requestedTimeZone);
  return {
    requestedTimeZone: requestedBounds.timeZone,
    timeZoneEffectiveAt: new Date(
      Math.max(options.currentPeriodResetAt.getTime(), requestedBounds.nextResetAt.getTime()),
    ),
    nextTimeZoneChangeEligibleAt: new Date(options.now.getTime() + timeZoneChangeWindowMs),
  };
}
