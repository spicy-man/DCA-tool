// NYSE rules: https://www.nyse.com/trade/hours-calendars
// Special closures must be maintained when announced.
const DAY_MS = 86400000;
const iso = time => new Date(time).toISOString().slice(0, 10);
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
const shift = (date, days) => iso(Date.parse(date + 'T12:00:00Z') + days * DAY_MS);

const nthWeekday = (year, month, targetWeekday, count) => {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  return shift(first, (targetWeekday - weekday(first) + 7) % 7 + 7 * (count - 1));
};

const observed = date => {
  const dayOfWeek = weekday(date);
  return dayOfWeek === 6 ? shift(date, -1) : dayOfWeek === 0 ? shift(date, 1) : date;
};

function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const v = h + l - 7 * m + 114;
  return `${year}-${String(Math.floor(v / 31)).padStart(2, '0')}-${String((v % 31) + 1).padStart(2, '0')}`;
}

const SPECIAL_CLOSURES = new Set([
  '2001-09-11',
  '2001-09-12',
  '2001-09-13',
  '2001-09-14',
  '2004-06-11',
  '2007-01-02',
  '2012-10-29',
  '2012-10-30',
  '2018-12-05',
  '2025-01-09'
]);

const holidayCache = new Map();

function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const jan1 = `${year}-01-01`;
  // Saturday New Year's Day is not observed on the prior Friday by NYSE.
  const dates = [
    weekday(jan1) === 0 ? shift(jan1, 1) : jan1,
    nthWeekday(year, 2, 1, 3),
    shift(easter(year), -2),
    shift(nthWeekday(year, 6, 1, 1), -7),
    observed(`${year}-07-04`),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observed(`${year}-12-25`)
  ];
  if (year >= 1998) dates.push(nthWeekday(year, 1, 1, 3));
  if (year >= 2022) dates.push(observed(`${year}-06-19`));
  const result = new Set(dates);
  holidayCache.set(year, result);
  return result;
}

export function periodKey(date, frequency) {
  if (frequency === 'monthly') return date.slice(0, 7);
  if (frequency === 'weekly') {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return date;
}

export function isTradingDay(date) {
  return (
    ![0, 6].includes(weekday(date)) &&
    !holidays(Number(date.slice(0, 4))).has(date) &&
    !SPECIAL_CLOSURES.has(date)
  );
}

export function nyDate(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function sessionClose(date) {
  const year = Number(date.slice(0, 4));
  const early =
    date === shift(nthWeekday(year, 11, 4, 4), 1) ||
    date === `${year}-12-24` ||
    date === `${year}-07-03`;
  const nyHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23'
    }).format(new Date(date + 'T17:00:00Z'))
  );
  return Date.parse(date + `T${String((early ? 13 : 16) + 17 - nyHour).padStart(2, '0')}:00:00Z`);
}

export function latestClosedSession(now = Date.now(), graceMinutes = 60) {
  let date = nyDate(now);
  for (let i = 0; i < 20; i++, date = shift(date, -1)) {
    if (isTradingDay(date) && now >= sessionClose(date) + graceMinutes * 60000) {
      return date;
    }
  }
  throw Error('无法确定最近已收盘交易日');
}
