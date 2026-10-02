import { and, eq, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, recurrenceRule, transaction } from '#/db/schema'
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

/** Omitted walletAddress and pluggyAccountId leave the sync config untouched (e.g. an MCP rename); null turns sync off. */
function syncValues(data: AccountInput) {
  if (data.pluggyAccountId) {
    return { walletAddress: null, pluggyAccountId: data.pluggyAccountId, syncKind: 'pluggy' as const, syncEnabled: data.syncEnabled ?? false, syncSince: data.syncSince ?? null }
  }
  if (data.walletAddress) {
    return { walletAddress: data.walletAddress, pluggyAccountId: null, syncKind: data.syncKind ?? null, syncEnabled: data.syncEnabled ?? false, syncSince: data.syncSince ?? null }
  }
  if (data.walletAddress === undefined && data.pluggyAccountId === undefined) return {}
  return { walletAddress: null, pluggyAccountId: null, syncKind: null, syncEnabled: false, syncSince: null, syncCursor: null, lastSyncError: null }
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
  const resync = (input.walletAddress !== undefined || input.pluggyAccountId !== undefined)
    && (values.walletAddress !== current.walletAddress || values.pluggyAccountId !== current.pluggyAccountId || values.syncKind !== current.syncKind || values.syncSince !== current.syncSince)
  const [row] = await db.update(account).set(resync ? { ...values, syncCursor: null, lastSyncedAt: null, lastSyncError: null } : values).where(and(eq(account.id, input.id), eq(account.userId, userId))).returning({ id: account.id })
  if (!row) throw new Error('Account not found')
  return { id: row.id }
}

export async function deleteAccountCore(userId: string, accountId: string) {
  const [used] = await db.select({ id: transaction.id }).from(transaction)
    .where(and(eq(transaction.userId, userId), or(eq(transaction.accountId, accountId), eq(transaction.counterAccountId, accountId)))).limit(1)
  const [usedByRule] = await db.select({ id: recurrenceRule.id }).from(recurrenceRule)
    .where(and(eq(recurrenceRule.userId, userId), eq(recurrenceRule.accountId, accountId))).limit(1)
  if (used || usedByRule) throw new Error('Esta conta tem transações ou recorrências. Mova-as para outra conta antes de excluir.')
  const rows = await db.delete(account).where(and(eq(account.id, accountId), eq(account.userId, userId))).returning({ id: account.id })
  return { deleted: rows.length }
}
