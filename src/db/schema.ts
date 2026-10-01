import { boolean, date, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { authUser } from './auth-schema'

export const txTypeEnum = pgEnum('tx_type', ['earn', 'expend', 'transfer'])
export const intervalEnum = pgEnum('rec_interval', ['daily', 'weekly', 'monthly', 'yearly'])
export const accountKindEnum = pgEnum('account_kind', ['credit_card', 'bank_account'])
export const syncKindEnum = pgEnum('sync_kind', ['wallet', 'etherfi_cash'])

const owner = () => text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' })

export const tag = pgTable('tag', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(), name: text().notNull(), color: text().notNull(),
})
export const category = tag

export const account = pgTable('account', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(), name: text().notNull(),
  kind: accountKindEnum().notNull(), limit: integer(),
  closingDay: integer('closing_day'), dueDay: integer('due_day'), prepaid: boolean().notNull().default(false),
  // Crypto auto-sync: an account is crypto when wallet_address is set (lowercase 0x…).
  walletAddress: text('wallet_address'), syncKind: syncKindEnum('sync_kind'),
  syncEnabled: boolean('sync_enabled').notNull().default(false), syncSince: date('sync_since'),
  /** `{ "<chainid>": lastProcessedBlock }` */
  syncCursor: jsonb('sync_cursor').$type<Record<string, number>>(),
  lastSyncedAt: timestamp('last_synced_at'), lastSyncError: text('last_sync_error'),
})

export const faturaPayment = pgTable('fatura_payment', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(),
  accountId: uuid('account_id').notNull().references(() => account.id, { onDelete: 'cascade' }),
  cycleKey: text('cycle_key').notNull(), paidAt: date('paid_at').notNull(),
}, (t) => [unique('uq_fatura_payment').on(t.accountId, t.cycleKey)])

export const recurrenceRule = pgTable('recurrence_rule', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(), amount: integer().notNull(),
  type: txTypeEnum().notNull(), interval: intervalEnum().notNull(), nextRun: date('next_run').notNull(),
  accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
  note: text(),
})

export const installmentPlan = pgTable('installment_plan', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(),
  accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
  totalAmount: integer('total_amount').notNull(), count: integer().notNull(),
  startDate: date('start_date').notNull(), note: text(),
})

export const transaction = pgTable('transaction', {
  id: uuid().primaryKey().defaultRandom(), userId: owner(), type: txTypeEnum().notNull(),
  amount: integer().notNull(), date: date().notNull(),
  accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
  counterAccountId: uuid('counter_account_id').references(() => account.id, { onDelete: 'set null' }),
  installmentPlanId: uuid('installment_plan_id').references(() => installmentPlan.id, { onDelete: 'cascade' }),
  recurrenceRuleId: uuid('recurrence_rule_id').references(() => recurrenceRule.id, { onDelete: 'set null' }),
  periodKey: text('period_key'), note: text(), paid: boolean().notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  /** `<chainid>:<txhash>:<logIndex>` for synced on-chain movements; idempotency lock. */
  externalId: text('external_id'), usdAmount: integer('usd_amount'),
}, (t) => [
  unique('uq_recurrence_period').on(t.recurrenceRuleId, t.periodKey),
  unique('uq_transaction_external').on(t.userId, t.externalId),
])

export const transactionTag = pgTable('transaction_tag', {
  transactionId: uuid('transaction_id').notNull().references(() => transaction.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ name: 'pk_transaction_tag', columns: [t.transactionId, t.tagId] })])

export const recurrenceRuleTag = pgTable('recurrence_rule_tag', {
  recurrenceRuleId: uuid('recurrence_rule_id').notNull().references(() => recurrenceRule.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ name: 'pk_recurrence_rule_tag', columns: [t.recurrenceRuleId, t.tagId] })])

export type Transaction = typeof transaction.$inferSelect
export type Tag = typeof tag.$inferSelect
export type Category = Tag
export type Account = typeof account.$inferSelect
export type InstallmentPlan = typeof installmentPlan.$inferSelect
export type RecurrenceRule = typeof recurrenceRule.$inferSelect
export type FaturaPayment = typeof faturaPayment.$inferSelect
