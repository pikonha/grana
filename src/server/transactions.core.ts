import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, installmentPlan, recurrenceRule, recurrenceRuleTag, tag, transaction, transactionTag } from '#/db/schema'
import { addMonths, splitInstallments } from '#/lib/installments'
import { assertMoney, paidByDate } from '#/lib/money'
import { addDays, appToday } from '#/lib/dates'
import { normalizeForMatch } from '#/lib/csv'
import { tagColorForIndex } from '#/lib/tag-colors'
import { transferNote } from '#/lib/transaction-labels'
import { inputTagIds, type DeleteRecurrenceInput, type ImportTransactionsInput, type TransactionInput, type TransactionPaidInput, type TransferInput, type UpdateRecurrenceRuleInput, type UpdateTransactionInput, type UpdateTransferInput } from './schemas'
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
  await assertOwnedTags(userId, tagIds, input.type)
  await assertOwnedAccounts(userId, [input.account_id])
  const todayISO = appToday()
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(transaction).values({
      userId, type: input.type, amount: input.amount, date: input.date, time: input.time ?? null,
      accountId: input.account_id, note: input.note ?? null,
      paid: input.paid ?? paidByDate(input.date, todayISO),
    }).returning({ id: transaction.id })
    if (tagIds.length) await tx.insert(transactionTag).values(transactionTagRows(row.id, tagIds))
    return { id: row.id }
  })
}

export async function updateTransactionCore(userId: string, input: UpdateTransactionInput) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedAccounts(userId, [input.account_id])
  const [existing] = await db.select({ planId: transaction.installmentPlanId }).from(transaction)
    .where(and(eq(transaction.id, input.id), eq(transaction.userId, userId)))
  // Installment plans are always expenses, whatever type the caller sent.
  await assertOwnedTags(userId, tagIds, existing?.planId ? 'expend' : input.type)
  // Installment rows keep amount/date/etc. (SUM(rows) === plan total); only tags change, on every parcela.
  if (existing?.planId) return setInstallmentPlanTags(userId, existing.planId, tagIds).then(() => ({ id: input.id }))
  return db.transaction(async (tx) => {
    const [row] = await tx.update(transaction).set({
      type: input.type,
      amount: input.amount,
      date: input.date,
      time: input.time ?? null,
      accountId: input.account_id,
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

async function setInstallmentPlanTags(userId: string, planId: string, tagIds: string[]) {
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: transaction.id }).from(transaction)
      .where(and(eq(transaction.installmentPlanId, planId), eq(transaction.userId, userId)))
    const ids = rows.map((row) => row.id)
    await tx.delete(transactionTag).where(inArray(transactionTag.transactionId, ids))
    if (tagIds.length) await tx.insert(transactionTag).values(ids.flatMap((id) => transactionTagRows(id, tagIds)))
  })
}

export async function createTransferCore(userId: string, input: TransferInput) {
  assertMoney(input.amount)
  await assertOwnedAccounts(userId, [input.account_id, input.counter_account_id])
  const [row] = await db.insert(transaction).values({
    userId, type: 'transfer', amount: input.amount, date: input.date, time: input.time ?? null,
    accountId: input.account_id, counterAccountId: input.counter_account_id, note: transferNote(input.note),
  }).returning({ id: transaction.id })
  return { id: row.id }
}

/** Earn and expend categories are separate sets, so the same name under each kind is two tags. */
const importTagKey = (kind: string, name: string) => `${kind}:${normalizeForMatch(name)}`

export function uniqueImportTagNames(data: ImportTransactionsInput) {
  const seen = new Set<string>()
  const tags: { name: string; kind: 'earn' | 'expend' }[] = []
  for (const row of data) {
    for (const name of row.tag_names ?? []) {
      const key = importTagKey(row.type, name)
      if (seen.has(key)) continue
      seen.add(key)
      tags.push({ name, kind: row.type })
    }
  }
  return tags
}

export async function importTransactionsCore(userId: string, data: ImportTransactionsInput) {
  data.forEach((row) => assertMoney(row.amount))
  await assertOwnedAccounts(userId, data.map((row) => row.account_id))
  return db.transaction(async (tx) => {
    const uniqueTags = uniqueImportTagNames(data)
    const tagMap = new Map<string, string>()
    if (uniqueTags.length) {
      const existingTags = await tx.select().from(tag).where(eq(tag.userId, userId))
      const keyToId = new Map<string, string>()
      for (const current of existingTags) keyToId.set(importTagKey(current.kind, current.name), current.id)
      const missing: typeof uniqueTags = []
      for (const current of uniqueTags) {
        const key = importTagKey(current.kind, current.name)
        const existing = keyToId.get(key)
        if (existing) {
          tagMap.set(key, existing)
        } else {
          missing.push(current)
        }
      }
      if (missing.length) {
        const created = await tx.insert(tag).values(missing.map((current, index) => ({
          userId, name: current.name, kind: current.kind, color: tagColorForIndex(existingTags.length + index),
        }))).returning({ id: tag.id, name: tag.name, kind: tag.kind })
        for (const current of created) tagMap.set(importTagKey(current.kind, current.name), current.id)
      }
    }
    const todayISO = appToday()
    const inserted = await tx.insert(transaction).values(data.map((row) => ({
      userId, type: row.type, amount: row.amount, date: row.date, time: row.time ?? null,
      accountId: row.account_id, note: row.note ?? null,
      paid: row.paid ?? paidByDate(row.date, todayISO),
    }))).returning({ id: transaction.id })
    const links: { transactionId: string; tagId: string }[] = []
    for (let i = 0; i < data.length; i++) {
      const tagIds = new Set(
        (data[i].tag_names ?? [])
          .map((name) => tagMap.get(importTagKey(data[i].type, name)))
          .filter((id): id is string => Boolean(id)),
      )
      for (const tagId of tagIds) links.push({ transactionId: inserted[i].id, tagId })
    }
    if (links.length) await tx.insert(transactionTag).values(links)
    return { count: inserted.length }
  })
}

export async function updateTransferCore(userId: string, input: UpdateTransferInput) {
  assertMoney(input.amount)
  await assertOwnedAccounts(userId, [input.account_id, input.counter_account_id])
  const [row] = await db.update(transaction).set({
    amount: input.amount, date: input.date, time: input.time ?? null,
    accountId: input.account_id, counterAccountId: input.counter_account_id, note: transferNote(input.note),
  }).where(and(eq(transaction.id, input.id), eq(transaction.userId, userId), eq(transaction.type, 'transfer')))
    .returning({ id: transaction.id })
  if (!row) throw new Error('Transfer not found')
  return { id: row.id }
}

export async function deleteTransactionCore(userId: string, id: string) {
  const rows = await db.delete(transaction).where(and(eq(transaction.id, id), eq(transaction.userId, userId))).returning({ id: transaction.id })
  return { deleted: rows.length }
}

export async function deleteInstallmentPlanCore(userId: string, id: string) {
  const rows = await db.delete(installmentPlan).where(and(eq(installmentPlan.id, id), eq(installmentPlan.userId, userId))).returning({ id: installmentPlan.id })
  return { deleted: rows.length }
}

export async function deleteRecurrenceRuleCore(userId: string, id: string) {
  const rows = await db.delete(recurrenceRule).where(and(eq(recurrenceRule.id, id), eq(recurrenceRule.userId, userId))).returning({ id: recurrenceRule.id })
  return { deleted: rows.length }
}

/** UI delete of a recurring row: the whole series, or only occurrences on/after `from` (the rule ends the day before). */
export async function deleteRecurrenceCore(userId: string, input: DeleteRecurrenceInput) {
  const owned = and(eq(recurrenceRule.id, input.rule_id), eq(recurrenceRule.userId, userId))
  return db.transaction(async (tx) => {
    const [rule] = await tx.select({ id: recurrenceRule.id }).from(recurrenceRule).where(owned)
    if (!rule) return { deleted: 0 }
    // Rows before the rule: deleting the rule nulls their recurrence_rule_id (onDelete: set null).
    const rows = await tx.delete(transaction).where(and(
      eq(transaction.recurrenceRuleId, rule.id),
      eq(transaction.userId, userId),
      input.from ? gte(transaction.date, input.from) : undefined,
    )).returning({ id: transaction.id })
    if (input.from) await tx.update(recurrenceRule).set({ endDate: addDays(input.from, -1) }).where(owned)
    else await tx.delete(recurrenceRule).where(owned)
    return { deleted: rows.length }
  })
}

export async function setTransactionPaidCore(userId: string, input: TransactionPaidInput) {
  // Moving to the payment day drops the old time: it belonged to the scheduled day.
  const rows = await db.update(transaction).set({ paid: input.paid, ...(input.date && { date: input.date, time: null }) }).where(and(eq(transaction.id, input.id), eq(transaction.userId, userId))).returning({ id: transaction.id })
  return { updated: rows.length }
}

/** `run` lets a caller (Pluggy sync) fold the plan into its own transaction. */
export async function createInstallmentPlanCore(userId: string, input: TransactionInput & { installments: { count: number } }, run: Pick<typeof db, 'transaction'> = db) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds, input.type)
  if (input.type !== 'expend' || !input.account_id) throw new Error('Installments require an expense and credit-card account')
  const [ownedAccount] = await db.select({ kind: account.kind, prepaid: account.prepaid }).from(account).where(
    and(eq(account.id, input.account_id), eq(account.userId, userId)),
  )
  if (ownedAccount?.kind !== 'credit_card') throw new Error('Installments require an owned credit-card account')
  // Prepaid cards have no fatura cycle, so their parcelas would be untracked debt.
  if (ownedAccount.prepaid) throw new Error('Installments are not available on prepaid cards')
  const amounts = splitInstallments(input.amount, input.installments.count)
  return run.transaction(async (tx) => {
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
  await assertOwnedTags(userId, tagIds, input.type)
  await assertOwnedAccounts(userId, [input.account_id])
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(recurrenceRule).values({
      userId, type: input.type, amount: input.amount, interval: input.recurrence.interval,
      nextRun: input.date, accountId: input.account_id, note: input.note ?? null,
    }).returning({ id: recurrenceRule.id })
    if (tagIds.length) await tx.insert(recurrenceRuleTag).values(recurrenceTagRows(row.id, tagIds))
    return { id: row.id }
  })
}

export async function updateRecurrenceRuleCore(userId: string, input: UpdateRecurrenceRuleInput) {
  assertMoney(input.amount)
  const tagIds = inputTagIds(input)
  await assertOwnedTags(userId, tagIds, input.type)
  await assertOwnedAccounts(userId, [input.account_id])
  return db.transaction(async (tx) => {
    const [row] = await tx.update(recurrenceRule).set({
      type: input.type, amount: input.amount, accountId: input.account_id, note: input.note ?? null,
    }).where(and(eq(recurrenceRule.id, input.id), eq(recurrenceRule.userId, userId)))
      .returning({ id: recurrenceRule.id })
    if (!row) throw new Error('Recurrence rule not found')
    await tx.delete(recurrenceRuleTag).where(eq(recurrenceRuleTag.recurrenceRuleId, row.id))
    if (tagIds.length) await tx.insert(recurrenceRuleTag).values(recurrenceTagRows(row.id, tagIds))
    return { id: row.id }
  })
}
