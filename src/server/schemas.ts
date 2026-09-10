import { z } from 'zod'
import { DEFAULT_TAG_COLOR } from '#/lib/tag-colors'
import { DEFAULT_TRANSFER_NOTE } from '#/lib/transaction-labels'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  // The regex alone lets 2026-13-01 / 2026-02-30 through; round-trip to reject them.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  }, 'date must be a real calendar date')
const cents = z.number().int('amount must be integer cents')
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB').transform((color) => color.toLowerCase())

export const transactionInput = z.object({
  type: z.enum(['earn', 'expend']), amount: cents.positive(), date: isoDate,
  tag_ids: z.array(z.string().uuid()).max(20).optional(),
  category_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
})
export type TransactionInput = z.infer<typeof transactionInput>

/** The hermes webhook rejects unknown keys instead of silently dropping them (e.g. `card_id`). */
export const webhookTransactionInput = transactionInput.strict()

export const updateTransactionInput = transactionInput.extend({
  id: z.string().uuid(),
})
export type UpdateTransactionInput = z.infer<typeof updateTransactionInput>

export const createTransactionInput = transactionInput.extend({
  installments: z.object({ count: z.number().int().min(2).max(360) }).optional(),
  recurrence: z.object({ interval: z.enum(['daily', 'weekly', 'monthly', 'yearly']) }).optional(),
}).refine((data) => !(data.installments && data.recurrence), {
  message: 'Installments and recurrence are mutually exclusive',
})
export type CreateTransactionInput = z.infer<typeof createTransactionInput>

export const transferInput = z.object({
  amount: cents.positive(), date: isoDate,
  account_id: z.string().uuid(), counter_account_id: z.string().uuid(),
  note: z.string().max(500).optional().default(DEFAULT_TRANSFER_NOTE),
}).refine((data) => data.account_id !== data.counter_account_id, {
  message: 'Cannot transfer to the same account',
})
export type TransferInput = z.infer<typeof transferInput>

export const faturaPaymentInput = z.object({ account_id: z.string().uuid(), cycle_key: isoDate, paid_at: isoDate.optional() })
export type FaturaPaymentInput = z.infer<typeof faturaPaymentInput>

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  color: hexColor.default(DEFAULT_TAG_COLOR),
})
export const accountInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['credit_card', 'bank_account']), limit: cents.nonnegative().optional(),
  closingDay: z.number().int().min(1).max(28).optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  prepaid: z.boolean().optional(),
}).refine((data) => data.kind !== 'credit_card' || data.prepaid || (data.closingDay !== undefined && data.dueDay !== undefined), {
  message: 'closingDay and dueDay are required for limit-based credit cards',
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
  type: z.enum(['earn', 'expend']), amount: cents.positive(), date: isoDate,
  tag_names: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  account_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
})).min(1).max(1000)
export type ImportTransactionsInput = z.infer<typeof importTransactionsInput>
