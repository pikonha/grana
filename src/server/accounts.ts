import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { account } from '#/db/schema'
import { accountInput, updateAccountInput } from './schemas'
import { createAccountCore, updateAccountCore } from './accounts.core'
import { requireUser } from './session.core'

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  return db.select().from(account).where(eq(account.userId, userId)).orderBy(asc(account.name))
})

export const createAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => accountInput.parse(data))
  .handler(async ({ data }) => createAccountCore(await requireUser(), data))

export const updateAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateAccountInput.parse(data))
  .handler(async ({ data }) => updateAccountCore(await requireUser(), data))

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => String((data as { id: string }).id))
  .handler(async ({ data: id }) => {
    const userId = await requireUser()
    await db.delete(account).where(and(eq(account.id, id), eq(account.userId, userId)))
    return { success: true }
  })
