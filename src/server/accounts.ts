import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, recurrenceRule, transaction } from '#/db/schema'
import { z } from 'zod'
import { accountInput, updateAccountInput } from './schemas'
import { createAccountCore, updateAccountCore } from './accounts.core'
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
  .handler(async ({ data: id }) => {
    const userId = await requireUser()
    // Every transaction must keep an account, so the FK's `set null` must never fire.
    const [used] = await db.select({ id: transaction.id }).from(transaction)
      .where(and(eq(transaction.userId, userId), or(eq(transaction.accountId, id), eq(transaction.counterAccountId, id)))).limit(1)
    const [usedByRule] = await db.select({ id: recurrenceRule.id }).from(recurrenceRule)
      .where(and(eq(recurrenceRule.userId, userId), eq(recurrenceRule.accountId, id))).limit(1)
    if (used || usedByRule) throw new Error('Esta conta tem transações ou recorrências. Mova-as para outra conta antes de excluir.')
    await db.delete(account).where(and(eq(account.id, id), eq(account.userId, userId)))
    return { success: true }
  })

export const syncAccountNow = createServerFn({ method: 'POST' })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id)
  .handler(async ({ data: id }) => syncAccountNowCore(await requireUser(), id))
