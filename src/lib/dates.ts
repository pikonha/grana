/**
 * Server "today" must match the user's wall clock, not UTC — at 21:00 in
 * UTC-3 `new Date().toISOString()` already reads tomorrow.
 */
const timeZone = (typeof process !== 'undefined' ? process.env.APP_TIMEZONE : undefined) ?? 'America/Sao_Paulo'

/** YYYY-MM-DD in the app timezone. */
export function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/** YYYY-MM in the app timezone. */
export function appMonthKey(): string {
  return appToday().slice(0, 7)
}
