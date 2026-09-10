import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, installmentPlan, recurrenceRule, recurrenceRuleTag, transaction, transactionTag } from '#/db/schema'
import { addMonths, splitInstallments } from '#/lib/installments'
import { assertMoney } from '#/lib/money'
import { transferNote } from '#/lib/transaction-labels'
import { inputTagIds, type TransactionInput, type TransferInput, type UpdateTransactionInput } from './schemas'
import { assertOwnedTags } from './tags.core'

export async function assertOwnedAccounts(userId: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((id): id is string => !!id))]
  if (!list.length) return
  const rows = await db.select({ id: account.id }).from(account).where(
    and(eq(account.userId, userId), inArray(account.id, list)),
  )
  if (rows.length !== list.length) throw new Error('One or more accounts do not exist')
}

const transactionTagRows = (transactionId: string, tagIds: string[]) => tagIds.map((tagId) => ({ transactionId, tagId }))
const recurrenceTagRows = (recurrenceRuleId: string, tagIds: string[]) => tagIds.map((tagId) => ({ recurrenceRuleId, tagId }))

export async function createTransactionCore(userId: string, input: TransactionInput) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds)
  await assertOwnedAccounts(userId, [input.account_id])
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(transaction).values({
      userId, type: input.type, amount: input.amount, date: input.date,
      accountId: input.account_id ?? null, note: input.note ?? null,
    }).returning({ id: transaction.id })
    if (tagIds.length) await tx.insert(transactionTag).values(transactionTagRows(row.id, tagIds))
    return { id: row.id }
  })
}

export async function updateTransactionCore(userId: string, input: UpdateTransactionInput) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds)
  await assertOwnedAccounts(userId, [input.account_id])
  return db.transaction(async (tx) => {
    const [row] = await tx.update(transaction).set({
      type: input.type,
      amount: input.amount,
      date: input.date,
      accountId: input.account_id ?? null,
      note: input.note ?? null,
    }).where(and(
      eq(transaction.id, input.id),
      eq(transaction.userId, userId),
      isNull(transaction.installmentPlanId),
      // A transfer keeps a counter account; rewriting its type would orphan that leg.
      ne(transaction.type, 'transfer'),
    )).returning({ id: transaction.id })
    if (!row) throw new Error('Transaction not found or cannot be edited')
    await tx.delete(transactionTag).where(eq(transactionTag.transactionId, row.id))
    if (tagIds.length) await tx.insert(transactionTag).values(transactionTagRows(row.id, tagIds))
    return { id: row.id }
  })
}

export async function createTransferCore(userId: string, input: TransferInput) {
  assertMoney(input.amount)
  await assertOwnedAccounts(userId, [input.account_id, input.counter_account_id])
  const [row] = await db.insert(transaction).values({
    userId, type: 'transfer', amount: input.amount, date: input.date,
    accountId: input.account_id, counterAccountId: input.counter_account_id, note: transferNote(input.note),
  }).returning({ id: transaction.id })
  return { id: row.id }
}

export async function createInstallmentPlanCore(userId: string, input: TransactionInput & { installments: { count: number } }) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds)
  if (input.type !== 'expend' || !input.account_id) throw new Error('Installments require an expense and credit-card account')
  const [ownedAccount] = await db.select({ kind: account.kind, prepaid: account.prepaid }).from(account).where(
    and(eq(account.id, input.account_id), eq(account.userId, userId)),
  )
  if (ownedAccount?.kind !== 'credit_card') throw new Error('Installments require an owned credit-card account')
  // Prepaid cards have no fatura cycle, so their parcelas would be untracked debt.
  if (ownedAccount.prepaid) throw new Error('Installments are not available on prepaid cards')
  const amounts = splitInstallments(input.amount, input.installments.count)
  return db.transaction(async (tx) => {
    const [plan] = await tx.insert(installmentPlan).values({
      userId, accountId: input.account_id, totalAmount: input.amount,
      count: input.installments.count, startDate: input.date, note: input.note ?? null,
    }).returning({ id: installmentPlan.id })
    const rows = await tx.insert(transaction).values(amounts.map((amount, index) => ({
      userId, type: 'expend' as const, amount, date: addMonths(input.date, index),
      accountId: input.account_id,
      installmentPlanId: plan.id, note: input.note ?? null,
    }))).returning({ id: transaction.id })
    if (tagIds.length) await tx.insert(transactionTag).values(rows.flatMap((row) => transactionTagRows(row.id, tagIds)))
    if (amounts.reduce((sum, value) => sum + value, 0) !== input.amount) throw new Error('Installment split drift')
    return { id: plan.id, rows: amounts.length }
  })
}

export async function createRecurrenceRuleCore(userId: string, input: TransactionInput & { recurrence: { interval: 'daily' | 'weekly' | 'monthly' | 'yearly' } }) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds)
  await assertOwnedAccounts(userId, [input.account_id])
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(recurrenceRule).values({
      userId, type: input.type, amount: input.amount, interval: input.recurrence.interval,
      nextRun: input.date, accountId: input.account_id ?? null, note: input.note ?? null,
    }).returning({ id: recurrenceRule.id })
    if (tagIds.length) await tx.insert(recurrenceRuleTag).values(recurrenceTagRows(row.id, tagIds))
    return { id: row.id }
  })
}
