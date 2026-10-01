import { createFileRoute } from '@tanstack/react-router'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withMcpAuth } from 'better-auth/plugins'
import { asc, desc, eq } from 'drizzle-orm'
import { auth } from '#/server/auth-config'
import { db } from '#/db/index'
import { account, installmentPlan, recurrenceRule, tag, transaction } from '#/db/schema'
import { appToday } from '#/lib/dates'
import { tagColorForIndex } from '#/lib/tag-colors'
import { accountInput, categoryInput, createTransactionInput, faturaPaymentInput, transferInput, updateAccountInput, updateTransactionInput } from '#/server/schemas'
import { createAccountCore, updateAccountCore } from '#/server/accounts.core'
import { tagsByRule, tagsByTransaction } from '#/server/tags.core'
import { createInstallmentPlanCore, createRecurrenceRuleCore, createTransactionCore, createTransferCore, updateTransactionCore } from '#/server/transactions.core'
import { listFaturasCore, markFaturaPaidCore, unmarkFaturaPaidCore } from '#/server/faturas.core'

/**
 * Multi-tenant MCP server: same-origin, no delete tools. Every tool resolves
 * `userId` from the OAuth access token session (via withMcpAuth), mirroring
 * the scoping requireUser() does for the UI's server functions.
 */
function buildServer(userId: string) {
  const server = new McpServer({ name: 'finances', version: '1.0.0' })

  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

  server.registerTool('list_accounts', { description: 'List the accounts (bank accounts, credit cards) owned by the authenticated user' }, async () => {
    const rows = await db.select().from(account).where(eq(account.userId, userId)).orderBy(asc(account.name))
    return text(rows)
  })

  server.registerTool('create_account', { description: 'Create a bank account or credit card', inputSchema: accountInput }, async (data) => {
    return text(await createAccountCore(userId, data))
  })

  server.registerTool('update_account', { description: 'Update one of the authenticated user\'s accounts', inputSchema: updateAccountInput }, async (data) => {
    return text(await updateAccountCore(userId, data))
  })

  server.registerTool('list_tags', { description: 'List the colored tags owned by the authenticated user (seeds defaults on first use)' }, async () => {
    // ponytail: mirrors listCategories() in src/server/categories.ts; that copy is a
    // createServerFn wrapper around requireUser(), so it can't be called with an MCP userId.
    const query = () => db.select().from(tag).where(eq(tag.userId, userId)).orderBy(asc(tag.name))
    const rows = await query()
    if (rows.length) return text(rows)
    const DEFAULTS = ['Groceries', 'Transport', 'Utilities', 'Entertainment', 'Salary']
    await db.insert(tag).values(DEFAULTS.map((name, index) => ({ userId, name, color: tagColorForIndex(index) })))
    return text(await query())
  })

  server.registerTool('create_tag', { description: 'Create a colored tag', inputSchema: categoryInput }, async (data) => {
    const [row] = await db.insert(tag).values({ userId, name: data.name, color: data.color }).returning({ id: tag.id })
    return text({ id: row.id })
  })

  server.registerTool('list_transactions', { description: 'List the transactions owned by the authenticated user, each with its tags' }, async () => {
    const rows = await db.select().from(transaction).where(eq(transaction.userId, userId)).orderBy(desc(transaction.date), desc(transaction.createdAt))
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

  server.registerTool('update_transaction', { description: 'Update a transaction (installment rows cannot be edited)', inputSchema: updateTransactionInput }, async (data) => {
    return text(await updateTransactionCore(userId, data))
  })

  server.registerTool('create_transfer', { description: 'Create a transfer between two of the user\'s own accounts', inputSchema: transferInput }, async (data) => {
    return text(await createTransferCore(userId, data))
  })

  server.registerTool('list_installment_plans', { description: 'List the installment plans owned by the authenticated user' }, async () => {
    const rows = await db.select().from(installmentPlan).where(eq(installmentPlan.userId, userId)).orderBy(asc(installmentPlan.startDate))
    return text(rows)
  })

  server.registerTool('list_recurrence_rules', { description: 'List the recurrence rules owned by the authenticated user, each with its tags' }, async () => {
    const rows = await db.select().from(recurrenceRule).where(eq(recurrenceRule.userId, userId)).orderBy(asc(recurrenceRule.nextRun))
    const groupedTags = await tagsByRule(rows.map((row) => row.id))
    return text(rows.map((row) => ({ ...row, tags: groupedTags.get(row.id) ?? [] })))
  })

  server.registerTool('list_faturas', { description: 'List the computed credit-card fatura (billing cycle) rows for the authenticated user' }, async () => {
    return text(await listFaturasCore(userId, appToday()))
  })

  server.registerTool('mark_fatura_paid', { description: 'Mark a fatura cycle as paid', inputSchema: faturaPaymentInput }, async (data) => {
    return text(await markFaturaPaidCore(userId, data))
  })

  server.registerTool('unmark_fatura_paid', { description: 'Undo marking a fatura cycle as paid', inputSchema: faturaPaymentInput }, async (data) => {
    return text(await unmarkFaturaPaidCore(userId, data))
  })

  return server
}

const handler = withMcpAuth(auth, async (request, session) => {
  const server = buildServer(session.userId)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
})

export const Route = createFileRoute('/api/mcp')({
  server: { handlers: { GET: ({ request }) => handler(request), POST: ({ request }) => handler(request) } },
})
