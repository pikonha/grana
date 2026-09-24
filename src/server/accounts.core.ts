import { and, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { account } from '#/db/schema'
import { assertMoney } from '#/lib/money'
import type { AccountInput, UpdateAccountInput } from './schemas'

export function accountValues(userId: string, data: AccountInput) {
  if (data.limit !== undefined) assertMoney(data.limit)
  const isCreditCard = data.kind === 'credit_card'
  const prepaid = isCreditCard && (data.prepaid ?? false)
  return {
    userId, name: data.name, kind: data.kind,
    limit: isCreditCard && !prepaid ? data.limit ?? null : null,
    closingDay: isCreditCard && !prepaid ? data.closingDay ?? null : null,
    dueDay: isCreditCard && !prepaid ? data.dueDay ?? null : null,
    prepaid,
    ...syncValues(data),
  }
}

/** Omitted walletAddress leaves the sync config untouched (e.g. an MCP rename); null turns sync off. */
function syncValues(data: AccountInput) {
  if (data.walletAddress === undefined) return {}
  if (data.walletAddress === null) {
    return { walletAddress: null, syncKind: null, syncEnabled: false, syncSince: null, syncCursor: null, lastSyncError: null }
  }
  return { walletAddress: data.walletAddress, syncKind: data.syncKind ?? null, syncEnabled: data.syncEnabled ?? false, syncSince: data.syncSince ?? null }
}

export async function createAccountCore(userId: string, input: AccountInput) {
  const [row] = await db.insert(account).values(accountValues(userId, input)).returning({ id: account.id })
  return { id: row.id }
}

export async function updateAccountCore(userId: string, input: UpdateAccountInput) {
  const [current] = await db.select().from(account).where(and(eq(account.id, input.id), eq(account.userId, userId)))
  if (!current) throw new Error('Account not found')
  const values = accountValues(userId, input)
  // A new address, kind or start date means a new backfill: restart from sync_since.
  const resync = 'syncSince' in values && (values.walletAddress !== current.walletAddress || values.syncKind !== current.syncKind || values.syncSince !== current.syncSince)
  const [row] = await db.update(account).set(resync ? { ...values, syncCursor: null, lastSyncedAt: null } : values).where(and(eq(account.id, input.id), eq(account.userId, userId))).returning({ id: account.id })
  if (!row) throw new Error('Account not found')
  return { id: row.id }
}
