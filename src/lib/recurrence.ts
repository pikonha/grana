/**
 * Recurrence date math on ISO `YYYY-MM-DD` strings, computed in UTC to avoid
 * timezone drift. Pure functions — covered by recurrence.test.ts.
 */
export type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly'

function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Idempotency key for a materialized occurrence. One row per (rule, period).
 * - daily:   YYYY-MM-DD
 * - weekly:  YYYY-MM-DD of the Monday of that week
 * - monthly: YYYY-MM
 * - yearly:  YYYY
 */
export function periodKey(interval: Interval, dateStr: string): string {
  const d = parse(dateStr)
  switch (interval) {
    case 'daily':
      return fmt(d)
    case 'weekly': {
      const dow = d.getUTCDay() // 0=Sun..6=Sat
      const deltaToMonday = (dow + 6) % 7
      d.setUTCDate(d.getUTCDate() - deltaToMonday)
      return fmt(d)
    }
    case 'monthly':
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
    case 'yearly':
      return String(d.getUTCFullYear())
  }
}

/** The next occurrence date after `dateStr` for the given interval. */
export function advance(interval: Interval, dateStr: string): string {
  const d = parse(dateStr)
  switch (interval) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1)
      break
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7)
      break
    case 'monthly':
      // ponytail: JS month overflow — Jan 31 + 1mo → Mar 3. Add end-of-month
      // clamping here if users schedule on the 29th–31st and it matters.
      d.setUTCMonth(d.getUTCMonth() + 1)
      break
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1)
      break
  }
  return fmt(d)
}

/** Calendar month containing the user's local date, without UTC rollover. */
export function localMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

/** Move a YYYY-MM key by a whole number of calendar months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

/**
 * Project not-yet-materialized recurrence dates into a month for display.
 * `nextRun` is always the first pending occurrence, so materialized rows are
 * never duplicated.
 */
export function scheduledDatesInMonth(
  interval: Interval,
  nextRun: string,
  month: string,
  endDate?: string | null,
): string[] {
  if (nextRun.slice(0, 7) > month) return []

  const dates: string[] = []
  let date = nextRun
  while (date.slice(0, 7) < month) date = advance(interval, date)
  while (date.slice(0, 7) === month && (!endDate || date <= endDate)) {
    dates.push(date)
    date = advance(interval, date)
  }
  return dates
}
