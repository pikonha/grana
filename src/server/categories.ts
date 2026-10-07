import { createServerFn } from '@tanstack/react-start'
import { db } from '#/db/index'
import { tag } from '#/db/schema'
import { categoryInput, deleteTagInput } from './schemas'
import { requireUser } from './session.core'
import { deleteTagCore, listTagsCore } from './tags.core'

export const listCategories = createServerFn({ method: 'GET' }).handler(async () => listTagsCore(await requireUser()))
export const listTags = listCategories

export const createCategory = createServerFn({ method: 'POST' })
  .validator((data: unknown) => categoryInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    const [row] = await db.insert(tag).values({ userId, name: data.name, color: data.color, kind: data.kind }).returning({ id: tag.id })
    return { id: row.id }
  })
export const createTag = createCategory

// Without replacementId, an in-use tag is not deleted: the caller gets the usage count and
// asks where to move it. replacementId null = just drop the tag from those rows.
export const deleteCategory = createServerFn({ method: 'POST' })
  .validator((data: unknown) => deleteTagInput.parse(data))
  .handler(async ({ data }) => deleteTagCore(await requireUser(), data))
export const deleteTag = deleteCategory
