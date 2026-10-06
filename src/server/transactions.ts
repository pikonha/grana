import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '#/db/index'
import { installmentPlan, recurrenceRule, transaction, type RecurrenceRule, type Tag, type Transaction } from '#/db/schema'
import { createTransactionInput, deleteRecurrenceInput, importTransactionsInput, transactionPaidInput, transferInput, updateRecurrenceRuleInput, updateTransactionInput, updateTransferInput } from './schemas'
import { createInstallmentPlanCore, createRecurrenceRuleCore, createTransactionCore, createTransferCore, deleteInstallmentPlanCore, deleteRecurrenceCore, deleteTransactionCore, importTransactionsCore, setTransactionPaidCore, updateRecurrenceRuleCore, updateTransactionCore, updateTransferCore } from './transactions.core'
import { tagsByRule, tagsByTransaction } from './tags.core'
import { requireUser } from './session.core'
import { materializeDueRules } from './recurrence.core'
import { appToday } from '#/lib/dates'

const idInput = (data: unknown) => String((data as { id: string }).id)
export type TransactionRow = Transaction & { tags: Tag[] }
export type RecurrenceRuleRow = RecurrenceRule & { tags: Tag[] }

export const listTransactions = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  // ponytail: lazy materialization on read replaces the daily cron job — idempotent
  // and catches up missed days, so rules are current whenever anyone looks.
  await materializeDueRules(appToday(), userId)
  const rows = await db.select().from(transaction).where(eq(transaction.userId, userId)).orderBy(desc(transaction.date), sql`${transaction.time} desc nulls last`, desc(transaction.createdAt))
  const groupedTags = await tagsByTransaction(rows.map((row) => row.id))
  return rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] }))
})

export const createTransaction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => createTransactionInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    if (data.installments) return createInstallmentPlanCore(userId, { ...data, installments: data.installments })
    if (data.recurrence) return createRecurrenceRuleCore(userId, { ...data, recurrence: data.recurrence })
    return createTransactionCore(userId, data)
  })

export const createTransfer = createServerFn({ method: 'POST' })
  .validator((data: unknown) => transferInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    return createTransferCore(userId, data)
  })

export const updateTransfer = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateTransferInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    return updateTransferCore(userId, data)
  })

export const updateTransaction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateTransactionInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    return updateTransactionCore(userId, data)
  })

export const deleteTransaction = createServerFn({ method: 'POST' }).validator(idInput).handler(async ({ data: id }) => {
  await deleteTransactionCore(await requireUser(), id)
  return { success: true }
})

export const listInstallmentPlans = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  return db.select().from(installmentPlan).where(eq(installmentPlan.userId, userId)).orderBy(asc(installmentPlan.startDate))
})
export const deleteInstallmentPlan = createServerFn({ method: 'POST' }).validator(idInput).handler(async ({ data: id }) => {
  await deleteInstallmentPlanCore(await requireUser(), id)
  return { success: true }
})

export const listRecurrenceRules = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  const rows = await db.select().from(recurrenceRule).where(eq(recurrenceRule.userId, userId)).orderBy(asc(recurrenceRule.nextRun))
  const groupedTags = await tagsByRule(rows.map((row) => row.id))
  return rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] }))
})
export const updateRecurrenceRule = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateRecurrenceRuleInput.parse(data))
  .handler(async ({ data }) => updateRecurrenceRuleCore(await requireUser(), data))
export const deleteRecurrence = createServerFn({ method: 'POST' })
  .validator((data: unknown) => deleteRecurrenceInput.parse(data))
  .handler(async ({ data }) => deleteRecurrenceCore(await requireUser(), data))

export const importTransactions = createServerFn({ method: 'POST' })
  .validator((data: unknown) => importTransactionsInput.parse(data))
  .handler(async ({ data }) => importTransactionsCore(await requireUser(), data))

export const setTransactionPaid = createServerFn({ method: 'POST' })
  .validator((data: unknown) => transactionPaidInput.parse(data))
  .handler(async ({ data }) => {
    await setTransactionPaidCore(await requireUser(), data)
    return { success: true }
  })
