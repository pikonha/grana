import { and, between, eq, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { recurrenceRule, recurrenceRuleTag, transaction, transactionTag, type RecurrenceRule } from '#/db/schema'
import { addDays } from '#/lib/dates'
import { advance, nearRecurrenceAmount, periodKey, RECURRENCE_MATCH_DAYS } from '#/lib/recurrence'

/**
 * Materialize every rule due on or before `today`. Idempotent via the
 * UNIQUE(recurrence_rule_id, period_key) constraint + ON CONFLICT DO NOTHING,
 * so running twice (or catching up missed days) never double-inserts.
 *
 * When the charge already came in through a sync (crypto/Pluggy) before the rule fired,
 * that synced row becomes the occurrence instead of inserting a duplicate.
 *
 * Server-only module (see transactions.core.ts) — keeps db/pg out of the client.
 */
export async function materializeDueRules(today: string, userId?: string) {
  const due = await db
    .select()
    .from(recurrenceRule)
    .where(and(
      lte(recurrenceRule.nextRun, today),
      or(isNull(recurrenceRule.endDate), lte(recurrenceRule.nextRun, recurrenceRule.endDate)),
      userId ? eq(recurrenceRule.userId, userId) : undefined,
    ))

  let inserted = 0
  for (const rule of due) {
    const tags = await db.select({ tagId: recurrenceRuleTag.tagId }).from(recurrenceRuleTag).where(eq(recurrenceRuleTag.recurrenceRuleId, rule.id))
    let next = rule.nextRun
    while (next <= today && (!rule.endDate || next <= rule.endDate)) {
      const key = periodKey(rule.interval, next)
      const adopted = await adoptSyncedRow(rule, next, key)
      const res = adopted ? [] : await db
        .insert(transaction)
        .values({
          userId: rule.userId,
          type: rule.type,
          amount: rule.amount,
          date: next,
          accountId: rule.accountId,
          recurrenceRuleId: rule.id,
          periodKey: key,
          note: rule.note,
        })
        .onConflictDoNothing({
          target: [transaction.recurrenceRuleId, transaction.periodKey],
        })
        .returning({ id: transaction.id })
      const id = adopted ?? res[0]?.id
      if (id && tags.length) {
        await db.insert(transactionTag).values(tags.map(({ tagId }) => ({ transactionId: id, tagId }))).onConflictDoNothing()
      }
      inserted += res.length
      next = advance(rule.interval, next)
    }
    await db
      .update(recurrenceRule)
      .set({ nextRun: next })
      .where(eq(recurrenceRule.id, rule.id))
  }
  return { rules: due.length, inserted }
}

/** Links the closest synced row (same account and type, ±7 days, ±3%) not yet tied to a rule as this occurrence. */
async function adoptSyncedRow(rule: RecurrenceRule, date: string, key: string): Promise<string | undefined> {
  if (rule.type === 'transfer' || !rule.accountId) return undefined
  const [taken] = await db.select({ id: transaction.id }).from(transaction)
    .where(and(eq(transaction.recurrenceRuleId, rule.id), eq(transaction.periodKey, key)))
  if (taken) return undefined
  // Shorter than the period, so a weekly/daily rule doesn't take a neighboring occurrence's charge.
  const window = { daily: 0, weekly: 3, monthly: RECURRENCE_MATCH_DAYS, yearly: RECURRENCE_MATCH_DAYS }[rule.interval]
  const candidates = await db.select({ id: transaction.id, amount: transaction.amount, date: transaction.date }).from(transaction).where(and(
    eq(transaction.userId, rule.userId), eq(transaction.accountId, rule.accountId), eq(transaction.type, rule.type),
    isNotNull(transaction.externalId), isNull(transaction.recurrenceRuleId), isNull(transaction.installmentPlanId),
    between(transaction.date, addDays(date, -window), addDays(date, window)),
  ))
  const days = (d: string) => Math.abs(Date.parse(d) - Date.parse(date))
  const best = candidates.filter((c) => nearRecurrenceAmount(c.amount, rule.amount))
    .sort((a, b) => Math.abs(a.amount - rule.amount) - Math.abs(b.amount - rule.amount) || days(a.date) - days(b.date))[0]
  if (!best) return undefined
  const [row] = await db.update(transaction).set({ recurrenceRuleId: rule.id, periodKey: key, note: rule.note })
    .where(and(eq(transaction.id, best.id), isNull(transaction.recurrenceRuleId))).returning({ id: transaction.id })
  return row?.id
}
