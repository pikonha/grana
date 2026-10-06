import { z } from 'zod'
import { DEFAULT_TAG_COLOR } from '#/lib/tag-colors'
import { DEFAULT_TRANSFER_NOTE } from '#/lib/transaction-labels'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  // The regex alone lets 2026-13-01 / 2026-02-30 through; round-trip to reject them.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'date must be a real calendar date')
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')
const cents = z.number().int('amount must be integer cents')
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB').transform((color) => color.toLowerCase())

export const transactionInput = z.object({
  type: z.enum(['earn', 'expend']), amount: cents.positive(), date: isoDate,
  /** HH:MM, wall clock in America/Sao_Paulo. */
  time: timeOfDay.optional(),
  tag_ids: z.array(z.string().uuid()).max(20).optional(),
  category_id: z.string().uuid().optional(),
  // Every transaction belongs to an account.
  account_id: z.string().uuid(),
  note: z.string().max(500).optional(),
  paid: z.boolean().optional(),
})
export type TransactionInput = z.infer<typeof transactionInput>

/** The hermes webhook rejects unknown keys instead of silently dropping them (e.g. `card_id`). */
export const webhookTransactionInput = transactionInput.strict()

export const updateTransactionInput = transactionInput.extend({
  id: z.string().uuid(),
}).omit({ paid: true })
export type UpdateTransactionInput = z.infer<typeof updateTransactionInput>

/** Edits the rule itself: applies to occurrences not generated yet. The schedule (date/interval) stays. */
export const updateRecurrenceRuleInput = transactionInput.extend({
  id: z.string().uuid(),
}).omit({ paid: true, date: true, time: true })
export type UpdateRecurrenceRuleInput = z.infer<typeof updateRecurrenceRuleInput>

export const createTransactionInput = transactionInput.extend({
  installments: z.object({ count: z.number().int().min(2).max(360) }).optional(),
  recurrence: z.object({ interval: z.enum(['daily', 'weekly', 'monthly', 'yearly']) }).optional(),
}).refine((data) => !(data.installments && data.recurrence), {
  message: 'Installments and recurrence are mutually exclusive',
})
export type CreateTransactionInput = z.infer<typeof createTransactionInput>

const transferFields = z.object({
  amount: cents.positive(), date: isoDate, time: timeOfDay.optional(),
  account_id: z.string().uuid(), counter_account_id: z.string().uuid(),
  note: z.string().max(500).optional().default(DEFAULT_TRANSFER_NOTE),
})
const distinctAccounts = [(data: { account_id: string; counter_account_id: string }) => data.account_id !== data.counter_account_id, {
  message: 'Cannot transfer to the same account',
}] as const
export const transferInput = transferFields.refine(...distinctAccounts)
export type TransferInput = z.infer<typeof transferInput>

export const updateTransferInput = transferFields.extend({ id: z.string().uuid() }).refine(...distinctAccounts)
export type UpdateTransferInput = z.infer<typeof updateTransferInput>

export const faturaPaymentInput = z.object({ account_id: z.string().uuid(), cycle_key: isoDate, paid_at: isoDate.optional() })
export type FaturaPaymentInput = z.infer<typeof faturaPaymentInput>
export const idInput = z.object({ id: z.string().uuid() })
// `date` moves the transaction to the day it was actually paid.
export const transactionPaidInput = z.object({ id: z.string().uuid(), paid: z.boolean(), date: isoDate.optional() })
export type TransactionPaidInput = z.infer<typeof transactionPaidInput>
// `from` omitted = the rule and every row it generated; set = only occurrences on/after it.
export const deleteRecurrenceInput = z.object({ rule_id: z.string().uuid(), from: isoDate.optional() })
export type DeleteRecurrenceInput = z.infer<typeof deleteRecurrenceInput>

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  color: hexColor.default(DEFAULT_TAG_COLOR),
})
export const deleteTagInput = z.object({
  id: z.string().uuid(),
  replacementId: z.string().uuid().nullable().optional(),
})
export type DeleteTagInput = z.infer<typeof deleteTagInput>
export const accountInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['credit_card', 'bank_account']), limit: cents.nonnegative().optional(),
  closingDay: z.number().int().min(1).max(28).optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  prepaid: z.boolean().optional(),
  // Omitted = keep as is (new accounts default to true).
  includeInTotal: z.boolean().optional(),
  // Crypto sync. walletAddress: omitted = keep as is, null = no longer a crypto account.
  walletAddress: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, 'walletAddress must be 0x + 40 hex chars').transform((a) => a.toLowerCase()).nullable().optional(),
  syncKind: z.enum(['wallet', 'etherfi_cash']).optional(),
  // Open Finance sync (Pluggy account UUID). Same null/omitted semantics as walletAddress; the sync kind is implied.
  pluggyAccountId: z.string().trim().min(1).max(100).nullable().optional(),
  syncEnabled: z.boolean().optional(),
  syncSince: isoDate.optional(),
}).refine((data) => data.kind !== 'credit_card' || data.prepaid || (data.closingDay !== undefined && data.dueDay !== undefined), {
  message: 'closingDay and dueDay are required for limit-based credit cards',
}).refine((data) => !data.walletAddress || (data.syncKind && data.syncSince), {
  message: 'syncKind and syncSince are required for crypto accounts',
}).refine((data) => !data.pluggyAccountId || data.syncSince, {
  message: 'syncSince is required for Open Finance accounts',
}).refine((data) => !(data.walletAddress && data.pluggyAccountId), {
  message: 'An account is either a crypto or an Open Finance account',
})
export type AccountInput = z.infer<typeof accountInput>

export const updateAccountInput = accountInput.extend({
  id: z.string().uuid(),
})
export type UpdateAccountInput = z.infer<typeof updateAccountInput>

export function inputTagIds(input: { tag_ids?: string[]; category_id?: string }) {
  return [...new Set(input.tag_ids ?? (input.category_id ? [input.category_id] : []))]
}

export const importTransactionsInput = z.array(z.object({
  type: z.enum(['earn', 'expend']), amount: cents.positive(), date: isoDate, time: timeOfDay.optional(),
  tag_names: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  account_id: z.string().uuid(),
  note: z.string().max(500).optional(),
  paid: z.boolean().optional(),
})).min(1).max(1000)
export type ImportTransactionsInput = z.infer<typeof importTransactionsInput>

/** MCP tool arguments must be an object; the UI server function keeps the raw array contract. */
export const importTransactionsToolInput = z.object({ transactions: importTransactionsInput })
export type ImportTransactionsToolInput = z.infer<typeof importTransactionsToolInput>
