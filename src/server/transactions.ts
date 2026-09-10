import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, installmentPlan, recurrenceRule, tag, transaction, transactionTag, type RecurrenceRule, type Tag, type Transaction } from '#/db/schema'
import { assertMoney } from '#/lib/money'
import { normalizeForMatch } from '#/lib/csv'
import { tagColorForIndex } from '#/lib/tag-colors'
import { createTransactionInput, importTransactionsInput, transferInput, updateTransactionInput } from './schemas'
import { createInstallmentPlanCore, createRecurrenceRuleCore, createTransactionCore, createTransferCore, updateTransactionCore } from './transactions.core'
import { tagsByRule, tagsByTransaction } from './tags.core'
import { requireUser } from './session.core'

const idInput = (data: unknown) => String((data as { id: string }).id)
export type TransactionRow = Transaction & { tags: Tag[] }
export type RecurrenceRuleRow = RecurrenceRule & { tags: Tag[] }

export const listTransactions = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  const rows = await db.select().from(transaction).where(eq(transaction.userId, userId)).orderBy(desc(transaction.date), desc(transaction.createdAt))
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

export const updateTransaction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => updateTransactionInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    return updateTransactionCore(userId, data)
  })

export const deleteTransaction = createServerFn({ method: 'POST' }).validator(idInput).handler(async ({ data: id }) => {
  const userId = await requireUser()
  await db.delete(transaction).where(and(eq(transaction.id, id), eq(transaction.userId, userId)))
  return { success: true }
})

export const listInstallmentPlans = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  return db.select().from(installmentPlan).where(eq(installmentPlan.userId, userId)).orderBy(asc(installmentPlan.startDate))
})
export const deleteInstallmentPlan = createServerFn({ method: 'POST' }).validator(idInput).handler(async ({ data: id }) => {
  const userId = await requireUser()
  await db.delete(installmentPlan).where(and(eq(installmentPlan.id, id), eq(installmentPlan.userId, userId)))
  return { success: true }
})

export const listRecurrenceRules = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUser()
  const rows = await db.select().from(recurrenceRule).where(eq(recurrenceRule.userId, userId)).orderBy(asc(recurrenceRule.nextRun))
  const groupedTags = await tagsByRule(rows.map((row) => row.id))
  return rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] }))
})
export const deleteRecurrenceRule = createServerFn({ method: 'POST' }).validator(idInput).handler(async ({ data: id }) => {
  const userId = await requireUser()
  await db.delete(recurrenceRule).where(and(eq(recurrenceRule.id, id), eq(recurrenceRule.userId, userId)))
  return { success: true }
})

export const importTransactions = createServerFn({ method: 'POST' })
  .validator((data: unknown) => importTransactionsInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUser()
    data.forEach((row) => assertMoney(row.amount))
    const accountIds = [...new Set(data.map((row) => row.account_id).filter(Boolean) as string[])]
    if (accountIds.length) {
      const ownedAccounts = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), inArray(account.id, accountIds)))
      if (ownedAccounts.length !== accountIds.length) throw new Error('One or more accounts do not exist')
    }
    const uniqueTagNames = [...new Set(data.flatMap((row) => row.tag_names ?? []))]
    const tagMap = new Map<string, string>()
    if (uniqueTagNames.length) {
      const existingTags = await db.select().from(tag).where(eq(tag.userId, userId))
      const normToId = new Map<string, string>()
      for (const t of existingTags) normToId.set(normalizeForMatch(t.name), t.id)
      const missing: string[] = []
      for (const name of uniqueTagNames) {
        const norm = normalizeForMatch(name)
        const existing = normToId.get(norm)
        if (existing) {
          tagMap.set(name, existing)
        } else {
          missing.push(name)
        }
      }
      if (missing.length) {
        const created = await db.insert(tag).values(missing.map((name, index) => ({
          userId, name, color: tagColorForIndex(existingTags.length + index),
        }))).returning({ id: tag.id, name: tag.name })
        for (const t of created) tagMap.set(t.name, t.id)
      }
    }
    return db.transaction(async (tx) => {
      const inserted = await tx.insert(transaction).values(data.map((row) => ({
        userId, type: row.type, amount: row.amount, date: row.date,
        accountId: row.account_id ?? null, note: row.note ?? null,
      }))).returning({ id: transaction.id })
      const links: { transactionId: string; tagId: string }[] = []
      for (let i = 0; i < data.length; i++) {
        const tagNames = data[i].tag_names ?? []
        for (const name of tagNames) {
          const tagId = tagMap.get(name)
          if (tagId) links.push({ transactionId: inserted[i].id, tagId })
        }
      }
      if (links.length) await tx.insert(transactionTag).values(links)
      return { count: inserted.length }
    })
  })
