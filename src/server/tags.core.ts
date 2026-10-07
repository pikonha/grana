import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db/index'
import { recurrenceRuleTag, tag, transactionTag, type Tag } from '#/db/schema'
import { tagColorForIndex } from '#/lib/tag-colors'
import type { DeleteTagInput } from './schemas'

const DEFAULT_TAGS = [
  ...['Mercado', 'Restaurantes', 'Transporte', 'Moradia', 'Saúde', 'Assinaturas', 'Lazer'].map((name) => ({ name, kind: 'expend' as const })),
  ...['Salário', 'Outras receitas'].map((name) => ({ name, kind: 'earn' as const })),
]

/** Lists the user's tags, seeding the defaults on first use. */
export async function listTagsCore(userId: string) {
  const query = () => db.select().from(tag).where(eq(tag.userId, userId)).orderBy(asc(tag.kind), asc(tag.name))
  const rows = await query()
  if (rows.length) return rows
  await db.insert(tag).values(DEFAULT_TAGS.map((current, index) => ({ userId, ...current, color: tagColorForIndex(index) })))
  return query()
}

// ponytail: kind checked here, not in the DB; a composite FK (tag_id, kind) → tag(id, kind) would enforce it there.
export async function assertOwnedTags(userId: string, tagIds: string[], type: 'earn' | 'expend'): Promise<void> {
  if (!tagIds.length) return
  const rows = await db.select({ id: tag.id, name: tag.name, kind: tag.kind }).from(tag).where(and(eq(tag.userId, userId), inArray(tag.id, tagIds)))
  if (rows.length !== tagIds.length) throw new Error('One or more tags do not exist')
  const wrong = rows.find((row) => row.kind !== type)
  if (wrong) throw new Error(`A categoria "${wrong.name}" é de ${wrong.kind === 'earn' ? 'receita' : 'despesa'}`)
}

export async function deleteTagCore(userId: string, data: DeleteTagInput) {
  const { id, replacementId } = data
  const owned = (tagId: string) => and(eq(tag.id, tagId), eq(tag.userId, userId))
  const [current] = await db.select({ id: tag.id, kind: tag.kind }).from(tag).where(owned(id))
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
    const [target] = await db.select({ id: tag.id, kind: tag.kind }).from(tag).where(owned(replacementId))
    if (!target) throw new Error('Etiqueta de destino não encontrada')
    if (target.kind !== current.kind) throw new Error('A etiqueta de destino precisa ser do mesmo tipo (receita ou despesa)')
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
    kind: tag.kind,
  }).from(transactionTag).innerJoin(tag, eq(transactionTag.tagId, tag.id)).where(inArray(transactionTag.transactionId, ids))
  for (const row of rows) {
    const current = grouped.get(row.transactionId) ?? []
    current.push({ id: row.id, userId: row.userId, name: row.name, color: row.color, kind: row.kind })
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
    kind: tag.kind,
  }).from(recurrenceRuleTag).innerJoin(tag, eq(recurrenceRuleTag.tagId, tag.id)).where(inArray(recurrenceRuleTag.recurrenceRuleId, ids))
  for (const row of rows) {
    const current = grouped.get(row.recurrenceRuleId) ?? []
    current.push({ id: row.id, userId: row.userId, name: row.name, color: row.color, kind: row.kind })
    grouped.set(row.recurrenceRuleId, current)
  }
  return grouped
}
