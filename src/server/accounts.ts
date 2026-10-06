import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { account } from '#/db/schema'
import { z } from 'zod'
import { accountInput, updateAccountInput } from './schemas'
import { createAccountCore, deleteAccountCore, setAccountIncludeInTotalCore, updateAccountCore } from './accounts.core'
import { requireUser } from './session.core'
import { listPluggyAccountsCore } from './pluggy-sync.core'
import { pluggyEnabled } from './pluggy-config'
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

export const setAccountIncludeInTotal = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string().uuid(), includeInTotal: z.boolean() }).parse(data))
  .handler(async ({ data }) => setAccountIncludeInTotalCore(await requireUser(), data.id, data.includeInTotal))

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: unknown) => String((data as { id: string }).id))
  .handler(async ({ data: id }) => deleteAccountCore(await requireUser(), id))

export const syncAccountNow = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id)
  .handler(async ({ data: id }) => syncAccountNowCore(await requireUser(), id))

/** Pluggy accounts for the account form's select; `enabled: false` hides the Open Finance section. */
export const listPluggyAccounts = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser()
  if (!pluggyEnabled()) return { enabled: false, accounts: [] }
  return { enabled: true, accounts: await listPluggyAccountsCore() }
})
