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
  }
}

export async function createAccountCore(userId: string, input: AccountInput) {
  const [row] = await db.insert(account).values(accountValues(userId, input)).returning({ id: account.id })
  return { id: row.id }
}

export async function updateAccountCore(userId: string, input: UpdateAccountInput) {
  const [row] = await db.update(account).set(accountValues(userId, input)).where(and(eq(account.id, input.id), eq(account.userId, userId))).returning({ id: account.id })
  if (!row) throw new Error('Account not found')
  return { id: row.id }
}
