/**
 * Server "today" must match the user's wall clock, not UTC — at 21:00 in
 * UTC-3 `new Date().toISOString()` already reads tomorrow.
 */
const timeZone = (typeof process !== 'undefined' ? process.env.APP_TIMEZONE : undefined) ?? 'America/Sao_Paulo'

/** YYYY-MM-DD in the app timezone (of `now`, default the current instant). */
export function appToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

/** YYYY-MM in the app timezone. */
export function appMonthKey(): string {
  return appToday().slice(0, 7)
}

/** YYYY-MM-DD shifted by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
