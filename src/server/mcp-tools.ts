import { asc, desc, eq, sql } from 'drizzle-orm'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { db } from '#/db/index'
import { account, installmentPlan, recurrenceRule, tag, transaction } from '#/db/schema'
import { appToday } from '#/lib/dates'
import { tagColorForIndex } from '#/lib/tag-colors'
import {
  accountInput,
  categoryInput,
  createTransactionInput,
  deleteTagInput,
  faturaPaymentInput,
  idInput,
  importTransactionsToolInput,
  transactionPaidInput,
  transferInput,
  updateAccountInput,
  updateRecurrenceRuleInput,
  updateTransactionInput,
  updateTransferInput,
} from './schemas'
import { createAccountCore, deleteAccountCore, updateAccountCore } from './accounts.core'
import { deleteTagCore, tagsByRule, tagsByTransaction } from './tags.core'
import {
  createInstallmentPlanCore,
  createRecurrenceRuleCore,
  createTransactionCore,
  createTransferCore,
  deleteInstallmentPlanCore,
  deleteRecurrenceRuleCore,
  deleteTransactionCore,
  importTransactionsCore,
  setTransactionPaidCore,
  updateRecurrenceRuleCore,
  updateTransactionCore,
  updateTransferCore,
} from './transactions.core'
import { listFaturasCore, markFaturaPaidCore, unmarkFaturaPaidCore } from './faturas.core'
import { isSyncing, syncAccountNowCore, syncDueAccounts } from './chain-sync.core'
import { materializeDueRules } from './recurrence.core'

/** Every operation exposed by the authenticated UI's finance server functions. */
export const MCP_TOOL_NAMES = [
  'list_accounts',
  'create_account',
  'update_account',
  'delete_account',
  'sync_account',
  'list_tags',
  'create_tag',
  'delete_tag',
  'list_transactions',
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'set_transaction_paid',
  'create_transfer',
  'update_transfer',
  'import_transactions',
  'list_installment_plans',
  'delete_installment_plan',
  'list_recurrence_rules',
  'update_recurrence_rule',
  'delete_recurrence_rule',
  'list_faturas',
  'mark_fatura_paid',
  'unmark_fatura_paid',
] as const

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

/**
 * Register the full finance surface for one authenticated Better Auth user.
 * Keep business logic in the shared server cores so the UI and MCP cannot drift.
 */
export function registerFinanceTools(server: McpServer, userId: string) {
  server.registerTool('list_accounts', {
    description: 'List the accounts (bank accounts, credit cards) owned by the authenticated user',
  }, async () => {
    await syncDueAccounts(userId)
    const rows = await db.select().from(account).where(eq(account.userId, userId)).orderBy(asc(account.name))
    return text(rows.map((row) => ({ ...row, syncing: isSyncing(row.id) })))
  })

  server.registerTool('create_account', {
    description: 'Create a bank account or credit card',
    inputSchema: accountInput,
  }, async (data) => text(await createAccountCore(userId, data)))

  server.registerTool('update_account', {
    description: 'Update one of the authenticated user\'s accounts, including crypto-sync settings',
    inputSchema: updateAccountInput,
  }, async (data) => text(await updateAccountCore(userId, data)))

  server.registerTool('delete_account', {
    description: 'Delete an unused account; accounts with transactions or recurrence rules are rejected',
    inputSchema: idInput,
  }, async ({ id }) => text(await deleteAccountCore(userId, id)))

  server.registerTool('sync_account', {
    description: 'Synchronize one configured crypto account immediately',
    inputSchema: idInput,
  }, async ({ id }) => text(await syncAccountNowCore(userId, id)))

  server.registerTool('list_tags', {
    description: 'List the colored tags owned by the authenticated user (seeds defaults on first use)',
  }, async () => {
    const query = () => db.select().from(tag).where(eq(tag.userId, userId)).orderBy(asc(tag.name))
    const rows = await query()
    if (rows.length) return text(rows)
    const defaults = ['Groceries', 'Transport', 'Utilities', 'Entertainment', 'Salary']
    await db.insert(tag).values(defaults.map((name, index) => ({ userId, name, color: tagColorForIndex(index) })))
    return text(await query())
  })

  server.registerTool('create_tag', {
    description: 'Create a colored tag',
    inputSchema: categoryInput,
  }, async (data) => {
    const [row] = await db.insert(tag).values({ userId, name: data.name, color: data.color }).returning({ id: tag.id })
    return text({ id: row.id })
  })

  server.registerTool('delete_tag', {
    description: 'Delete a tag. Without replacementId, report usage instead of deleting an in-use tag; null removes its links',
    inputSchema: deleteTagInput,
  }, async (data) => text(await deleteTagCore(userId, data)))

  server.registerTool('list_transactions', {
    description: 'List the transactions owned by the authenticated user, each with its tags; materializes due recurrences first',
  }, async () => {
    await materializeDueRules(appToday(), userId)
    const rows = await db.select().from(transaction)
      .where(eq(transaction.userId, userId))
      .orderBy(desc(transaction.date), sql`${transaction.time} desc nulls last`, desc(transaction.createdAt))
    const groupedTags = await tagsByTransaction(rows.map((row) => row.id))
    return text(rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] })))
  })

  server.registerTool('create_transaction', {
    description: 'Create a transaction. Optionally split into installments (credit-card expense) or set up a recurrence rule (installments and recurrence are mutually exclusive)',
    inputSchema: createTransactionInput,
  }, async (data) => {
    if (data.installments) return text(await createInstallmentPlanCore(userId, { ...data, installments: data.installments }))
    if (data.recurrence) return text(await createRecurrenceRuleCore(userId, { ...data, recurrence: data.recurrence }))
    return text(await createTransactionCore(userId, data))
  })

  server.registerTool('update_transaction', {
    description: 'Update a transaction. On an installment row only tag_ids apply, to every installment of the plan; other fields are ignored',
    inputSchema: updateTransactionInput,
  }, async (data) => text(await updateTransactionCore(userId, data)))

  server.registerTool('delete_transaction', {
    description: 'Delete one transaction. Deleting a single installment row leaves the rest of its plan; use delete_installment_plan to remove a whole purchase',
    inputSchema: idInput,
  }, async ({ id }) => text(await deleteTransactionCore(userId, id)))

  server.registerTool('set_transaction_paid', {
    description: 'Mark or unmark a payment-trackable transaction as paid; pass date (YYYY-MM-DD) to also move it to the day it was paid',
    inputSchema: transactionPaidInput,
  }, async (data) => text(await setTransactionPaidCore(userId, data)))

  server.registerTool('create_transfer', {
    description: 'Create a transfer between two of the user\'s own accounts',
    inputSchema: transferInput,
  }, async (data) => text(await createTransferCore(userId, data)))

  server.registerTool('update_transfer', {
    description: 'Update an existing transfer between two of the user\'s own accounts',
    inputSchema: updateTransferInput,
  }, async (data) => text(await updateTransferCore(userId, data)))

  server.registerTool('import_transactions', {
    description: 'Import up to 1000 transactions, creating or matching tags by normalized name',
    inputSchema: importTransactionsToolInput,
  }, async ({ transactions }) => text(await importTransactionsCore(userId, transactions)))

  server.registerTool('list_installment_plans', {
    description: 'List the installment plans owned by the authenticated user',
  }, async () => {
    const rows = await db.select().from(installmentPlan).where(eq(installmentPlan.userId, userId)).orderBy(asc(installmentPlan.startDate))
    return text(rows)
  })

  server.registerTool('delete_installment_plan', {
    description: 'Delete an installment plan and all of its installment rows',
    inputSchema: idInput,
  }, async ({ id }) => text(await deleteInstallmentPlanCore(userId, id)))

  server.registerTool('list_recurrence_rules', {
    description: 'List the recurrence rules owned by the authenticated user, each with its tags',
  }, async () => {
    const rows = await db.select().from(recurrenceRule).where(eq(recurrenceRule.userId, userId)).orderBy(asc(recurrenceRule.nextRun))
    const groupedTags = await tagsByRule(rows.map((row) => row.id))
    return text(rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] })))
  })

  server.registerTool('update_recurrence_rule', {
    description: 'Update a recurrence rule (type, amount, account, note, tags). Applies to occurrences not generated yet; the schedule stays',
    inputSchema: updateRecurrenceRuleInput,
  }, async (data) => text(await updateRecurrenceRuleCore(userId, data)))

  server.registerTool('delete_recurrence_rule', {
    description: 'Delete a recurrence rule and stop future materialization; existing occurrences remain',
    inputSchema: idInput,
  }, async ({ id }) => text(await deleteRecurrenceRuleCore(userId, id)))

  server.registerTool('list_faturas', {
    description: 'List the computed credit-card fatura (billing cycle) rows for the authenticated user',
  }, async () => text(await listFaturasCore(userId, appToday())))

  server.registerTool('mark_fatura_paid', {
    description: 'Mark a fatura cycle as paid',
    inputSchema: faturaPaymentInput,
  }, async (data) => text(await markFaturaPaidCore(userId, data)))

  server.registerTool('unmark_fatura_paid', {
    description: 'Undo marking a fatura cycle as paid',
    inputSchema: faturaPaymentInput,
  }, async (data) => text(await unmarkFaturaPaidCore(userId, data)))
}
