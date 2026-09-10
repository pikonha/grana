import { eq, lte } from 'drizzle-orm'
import { db } from '#/db/index'
import { recurrenceRule, recurrenceRuleTag, transaction, transactionTag } from '#/db/schema'
import { advance, periodKey } from '#/lib/recurrence'

/**
 * Materialize every rule due on or before `today`. Idempotent via the
 * UNIQUE(recurrence_rule_id, period_key) constraint + ON CONFLICT DO NOTHING,
 * so running twice (or catching up missed days) never double-inserts.
 *
 * Server-only module (see transactions.core.ts) — keeps db/pg out of the client.
 */
export async function materializeDueRules(today: string) {
  const due = await db
    .select()
    .from(recurrenceRule)
    .where(lte(recurrenceRule.nextRun, today))

  let inserted = 0
  for (const rule of due) {
    const tags = await db.select({ tagId: recurrenceRuleTag.tagId }).from(recurrenceRuleTag).where(eq(recurrenceRuleTag.recurrenceRuleId, rule.id))
    let next = rule.nextRun
    while (next <= today) {
      const res = await db
        .insert(transaction)
        .values({
          userId: rule.userId,
          type: rule.type,
          amount: rule.amount,
          date: next,
          accountId: rule.accountId,
          recurrenceRuleId: rule.id,
          periodKey: periodKey(rule.interval, next),
          note: rule.note,
        })
        .onConflictDoNothing({
          target: [transaction.recurrenceRuleId, transaction.periodKey],
        })
        .returning({ id: transaction.id })
      if (res.length && tags.length) {
        await db.insert(transactionTag).values(tags.map(({ tagId }) => ({ transactionId: res[0].id, tagId }))).onConflictDoNothing()
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
