import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { account } from '#/db/schema'
import { z } from 'zod'
import { accountInput, updateAccountInput } from './schemas'
import { createAccountCore, deleteAccountCore, updateAccountCore } from './accounts.core'
import { requireUser } from './session.core'
import { isSyncing, syncAccountNowCore, syncDueAccounts } from './chain-sync.core'

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  // Claims due crypto accounts before the select, so the page sees `syncing` on its first load.
  await syncDueAccounts(userId)
  const rows = await db.select().from(account).where(eq(account.userId, userId)).orderBy(asc(account.name))
  return rows.map((row) => ({ ...row, syncing: isSyncing(row.id) }))
})

export const createAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => accountInput.parse(data))
  .handler(async ({ data }) => createAccountCore(await requireUser(), data))

export const updateAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateAccountInput.parse(data))
  .handler(async ({ data }) => updateAccountCore(await requireUser(), data))

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => String((data as { id: string }).id))
  .handler(async ({ data: id }) => deleteAccountCore(await requireUser(), id))

export const syncAccountNow = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id)
  .handler(async ({ data: id }) => syncAccountNowCore(await requireUser(), id))
