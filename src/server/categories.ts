import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { tag } from '#/db/schema'
import { tagColorForIndex } from '#/lib/tag-colors'
import { categoryInput, deleteTagInput } from './schemas'
import { requireUser } from './session.core'
import { deleteTagCore } from './tags.core'

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
  .validator((data: unknown) => deleteTagInput.parse(data))
  .handler(async ({ data }) => deleteTagCore(await requireUser(), data))
export const deleteTag = deleteCategory
