import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db/index'
import { recurrenceRuleTag, tag, transactionTag, type Tag } from '#/db/schema'
import type { DeleteTagInput } from './schemas'

export async function assertOwnedTags(userId: string, tagIds: string[]): Promise<void> {
  if (!tagIds.length) return
  const rows = await db.select({ id: tag.id }).from(tag).where(and(eq(tag.userId, userId), inArray(tag.id, tagIds)))
  if (rows.length !== tagIds.length) throw new Error('One or more tags do not exist')
}

export async function deleteTagCore(userId: string, data: DeleteTagInput) {
  const { id, replacementId } = data
  const owned = (tagId: string) => and(eq(tag.id, tagId), eq(tag.userId, userId))
  const [current] = await db.select({ id: tag.id }).from(tag).where(owned(id))
  if (!current) throw new Error('Etiqueta não encontrada')
  if (replacementId === undefined) {
    const [[tx], [rules]] = await Promise.all([
      db.select({ n: count() }).from(transactionTag).where(eq(transactionTag.tagId, id)),
      db.select({ n: count() }).from(recurrenceRuleTag).where(eq(recurrenceRuleTag.tagId, id)),
    ])
    const inUse = tx.n + rules.n
    if (inUse) return { deleted: false, inUse }
  }
  if (replacementId) {
    if (replacementId === id) throw new Error('Escolha outra etiqueta')
    const [target] = await db.select({ id: tag.id }).from(tag).where(owned(replacementId))
    if (!target) throw new Error('Etiqueta de destino não encontrada')
  }
  await db.transaction(async (tx) => {
    if (replacementId) {
      await tx.execute(sql`insert into transaction_tag (transaction_id, tag_id)
        select transaction_id, ${replacementId}::uuid from transaction_tag where tag_id = ${id} on conflict do nothing`)
      await tx.execute(sql`insert into recurrence_rule_tag (recurrence_rule_id, tag_id)
        select recurrence_rule_id, ${replacementId}::uuid from recurrence_rule_tag where tag_id = ${id} on conflict do nothing`)
    }
    await tx.delete(tag).where(owned(id))
  })
  return { deleted: true, inUse: 0 }
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
