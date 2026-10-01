import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { recurrenceRuleTag, tag, transactionTag } from '#/db/schema'
import { tagColorForIndex } from '#/lib/tag-colors'
import { categoryInput } from './schemas'
import { requireUser } from './session.core'

const DEFAULTS = ['Groceries', 'Transport', 'Utilities', 'Entertainment', 'Salary']

export const listCategories = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  const query = () => db.select().from(tag).where(eq(tag.userId, userId)).orderBy(asc(tag.name))
  const rows = await query()
  if (rows.length) return rows
  await db.insert(tag).values(DEFAULTS.map((name, index) => ({ userId, name, color: tagColorForIndex(index) })))
  return query()
})
export const listTags = listCategories

export const createCategory = createServerFn({ method: 'POST' })
  .validator((data: unknown) => categoryInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    const [row] = await db.insert(tag).values({ userId, name: data.name, color: data.color }).returning({ id: tag.id })
    return { id: row.id }
  })
export const createTag = createCategory

// Without replacementId, an in-use tag is not deleted: the caller gets the usage count and
// asks where to move it. replacementId null = just drop the tag from those rows.
export const deleteCategory = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), replacementId: z.string().uuid().nullable().optional() }).parse(data),
  )
  .handler(async ({ data: { id, replacementId } }) => {
    const userId = await requireUser()
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
      // FK cascade drops the old tag's links.
      await tx.delete(tag).where(owned(id))
    })
    return { deleted: true, inUse: 0 }
  })
export const deleteTag = deleteCategory
