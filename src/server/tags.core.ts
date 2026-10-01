import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#/db/index'
import { recurrenceRuleTag, tag, transactionTag, type Tag } from '#/db/schema'

export async function assertOwnedTags(userId: string, tagIds: string[]): Promise<void> {
  if (!tagIds.length) return
  const rows = await db.select({ id: tag.id }).from(tag).where(and(eq(tag.userId, userId), inArray(tag.id, tagIds)))
  if (rows.length !== tagIds.length) throw new Error('One or more tags do not exist')
}

export async function tagsByTransaction(ids: string[]): Promise<Map<string, Tag[]>> {
  const grouped = new Map<string, Tag[]>()
  if (!ids.length) return grouped
  const rows = await db.select({
    transactionId: transactionTag.transactionId,
    id: tag.id,
    userId: tag.userId,
    name: tag.name,
    color: tag.color,
  }).from(transactionTag).innerJoin(tag, eq(transactionTag.tagId, tag.id)).where(inArray(transactionTag.transactionId, ids))
  for (const row of rows) {
    const current = grouped.get(row.transactionId) ?? []
    current.push({ id: row.id, userId: row.userId, name: row.name, color: row.color })
    grouped.set(row.transactionId, current)
  }
  return grouped
}

export async function tagsByRule(ids: string[]): Promise<Map<string, Tag[]>> {
  const grouped = new Map<string, Tag[]>()
  if (!ids.length) return grouped
  const rows = await db.select({
    recurrenceRuleId: recurrenceRuleTag.recurrenceRuleId,
    id: tag.id,
    userId: tag.userId,
    name: tag.name,
    color: tag.color,
  }).from(recurrenceRuleTag).innerJoin(tag, eq(recurrenceRuleTag.tagId, tag.id)).where(inArray(recurrenceRuleTag.recurrenceRuleId, ids))
  for (const row of rows) {
    const current = grouped.get(row.recurrenceRuleId) ?? []
    current.push({ id: row.id, userId: row.userId, name: row.name, color: row.color })
    grouped.set(row.recurrenceRuleId, current)
  }
  return grouped
}
