import type { InferInsertModel } from 'drizzle-orm'

import { authAccount, authUser } from './auth-schema'
import {
  account,
  category,
  faturaPayment,
  installmentPlan,
  recurrenceRule,
  recurrenceRuleTag,
  transaction,
  transactionTag,
} from './schema'
import { cycleKeyFor, vencimentoFor } from '../lib/faturas'
import { addMonths, splitInstallments } from '../lib/installments'

export const SEED_USER_ID = 'local-demo-user'
export const SEED_EMAIL = 'a@b.com'
export const SEED_PASSWORD = '1234'

type SeedData = {
  user: InferInsertModel<typeof authUser>
  authAccount: InferInsertModel<typeof authAccount>
  categories: InferInsertModel<typeof category>[]
  accounts: InferInsertModel<typeof account>[]
  recurrenceRules: InferInsertModel<typeof recurrenceRule>[]
  recurrenceRuleTags: InferInsertModel<typeof recurrenceRuleTag>[]
  installmentPlans: InferInsertModel<typeof installmentPlan>[]
  transactions: InferInsertModel<typeof transaction>[]
  transactionTags: InferInsertModel<typeof transactionTag>[]
  faturaPayments: InferInsertModel<typeof faturaPayment>[]
}

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const pad = (value: number) => String(value).padStart(2, '0')

export function monthDate(anchor: string, monthOffset: number, requestedDay: number): string {
  const [year, month] = anchor.split('-').map(Number)
  const targetMonth = month - 1 + monthOffset
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate()
  const date = new Date(Date.UTC(year, targetMonth, Math.min(requestedDay, lastDay)))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function assertLocalDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error('DATABASE_URL is required. Set it in .env.local or the shell.')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.')
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'db'])
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !localHosts.has(url.hostname)) {
    throw new Error(`Refusing to seed non-local database host "${url.hostname}".`)
  }
  return url
}

export function buildSeedData(anchor = new Date().toISOString().slice(0, 10)): SeedData {
  const seededAt = new Date(`${anchor}T12:00:00.000Z`)
  const categoryIds = {
    salary: uuid(1), freelance: uuid(2), housing: uuid(3), groceries: uuid(4),
    utilities: uuid(5), dining: uuid(6), transport: uuid(7), subscriptions: uuid(8),
    health: uuid(9), shopping: uuid(10),
  }
  const accountIds = {
    checking: uuid(101), savings: uuid(102), visa: uuid(103), mastercard: uuid(104), prepaid: uuid(105),
  }
  const ruleIds = { salary: uuid(201), rent: uuid(202), streaming: uuid(203) }
  const planId = uuid(301)

  const categories: SeedData['categories'] = [
    ['salary', 'Salary'], ['freelance', 'Freelance'], ['housing', 'Housing'],
    ['groceries', 'Groceries'], ['utilities', 'Utilities'], ['dining', 'Dining'],
    ['transport', 'Transport'], ['subscriptions', 'Subscriptions'], ['health', 'Health'],
    ['shopping', 'Shopping'],
  ].map(([key, name]) => ({
    id: categoryIds[key as keyof typeof categoryIds], userId: SEED_USER_ID, name,
    kind: key === 'salary' || key === 'freelance' ? 'earn' as const : 'expend' as const,
  }))
    .map((row, index) => ({ ...row, color: ['#16a34a', '#0891b2', '#d97706', '#2563eb', '#7c3aed', '#dc2626', '#ea580c', '#4f46e5', '#65a30d', '#db2777'][index] }))

  const accounts: SeedData['accounts'] = [
    { id: accountIds.checking, userId: SEED_USER_ID, name: 'Main checking', kind: 'bank_account' },
    { id: accountIds.savings, userId: SEED_USER_ID, name: 'Emergency savings', kind: 'bank_account' },
    {
      id: accountIds.visa, userId: SEED_USER_ID, name: 'Visa', kind: 'credit_card',
      limit: 1_200_000, closingDay: 20, dueDay: 10, prepaid: false,
    },
    {
      id: accountIds.mastercard, userId: SEED_USER_ID, name: 'Mastercard', kind: 'credit_card',
      limit: 900_000, closingDay: 8, dueDay: 15, prepaid: false,
    },
    {
      id: accountIds.prepaid, userId: SEED_USER_ID, name: 'Meal card', kind: 'credit_card', prepaid: true,
    },
  ]

  const recurrenceRuleTags: SeedData['recurrenceRuleTags'] = []
  const nextRule = (
    values: Omit<InferInsertModel<typeof recurrenceRule>, 'categoryId'> & { categoryId?: string },
  ): InferInsertModel<typeof recurrenceRule> => {
    const { categoryId, ...row } = values
    if (categoryId) recurrenceRuleTags.push({ recurrenceRuleId: row.id!, tagId: categoryId })
    return row
  }

  const recurrenceRules: SeedData['recurrenceRules'] = [
    nextRule(
    {
      id: ruleIds.salary, userId: SEED_USER_ID, amount: 850_000, type: 'earn', interval: 'monthly', accountId: accountIds.checking,
      nextRun: monthDate(anchor, 1, 5), categoryId: categoryIds.salary, note: 'Monthly salary',
    }),
    nextRule(
    {
      id: ruleIds.rent, userId: SEED_USER_ID, amount: 220_000, type: 'expend', interval: 'monthly', accountId: accountIds.checking,
      nextRun: monthDate(anchor, 1, 10), categoryId: categoryIds.housing, note: 'Apartment rent',
    }),
    nextRule(
    {
      id: ruleIds.streaming, userId: SEED_USER_ID, amount: 4_990, type: 'expend', interval: 'monthly', accountId: accountIds.visa,
      nextRun: monthDate(anchor, 1, 8), categoryId: categoryIds.subscriptions, note: 'Streaming subscription',
    }),
  ]

  const installmentAmounts = splitInstallments(749_900, 6)
  const installmentPlans: SeedData['installmentPlans'] = [{
    id: planId, userId: SEED_USER_ID, accountId: accountIds.mastercard,
    totalAmount: 749_900, count: 6, startDate: monthDate(anchor, -2, 14), note: 'Notebook',
  }]

  let transactionSequence = 1_000
  const transactionTags: SeedData['transactionTags'] = []
  const nextTransaction = (
    values: Omit<InferInsertModel<typeof transaction>, 'id' | 'userId' | 'categoryId'> & { categoryId?: string; tagIds?: string[] },
  ): InferInsertModel<typeof transaction> => {
    const { categoryId, tagIds = [], ...rowValues } = values
    const row = { id: uuid(transactionSequence++), userId: SEED_USER_ID, ...rowValues }
    for (const tagId of [...new Set([...(categoryId ? [categoryId] : []), ...tagIds])]) {
      transactionTags.push({ transactionId: row.id, tagId })
    }
    return row
  }

  const transactions: SeedData['transactions'] = []
  for (let offset = -5; offset <= 0; offset += 1) {
    const monthlyPeriod = monthDate(anchor, offset, 1).slice(0, 7)
    transactions.push(
      nextTransaction({
        type: 'earn', amount: 850_000, date: monthDate(anchor, offset, 5),
        categoryId: categoryIds.salary, accountId: accountIds.checking,
        recurrenceRuleId: ruleIds.salary, periodKey: monthlyPeriod, note: 'Monthly salary',
      }),
      nextTransaction({
        type: 'expend', amount: 220_000, date: monthDate(anchor, offset, 10),
        categoryId: categoryIds.housing, accountId: accountIds.checking,
        recurrenceRuleId: ruleIds.rent, periodKey: monthlyPeriod, note: 'Apartment rent',
      }),
      nextTransaction({
        type: 'expend', amount: 17_900 + (offset + 5) * 725, date: monthDate(anchor, offset, 12),
        categoryId: categoryIds.utilities, accountId: accountIds.checking, note: 'Electricity and internet',
      }),
      nextTransaction({
        type: 'expend', amount: 42_500 + (offset + 5) * 1_250, date: monthDate(anchor, offset, 7),
        categoryId: categoryIds.groceries, accountId: accountIds.checking, note: 'Weekly groceries',
      }),
      nextTransaction({
        type: 'expend', amount: 31_750 + (offset + 5) * 980, date: monthDate(anchor, offset, 21),
        categoryId: categoryIds.groceries, accountId: accountIds.checking, note: 'Groceries restock',
      }),
      nextTransaction({
        type: 'expend', amount: 12_900 + (offset + 5) * 610, date: monthDate(anchor, offset, 15),
        categoryId: categoryIds.dining, accountId: accountIds.visa, note: 'Dinner out',
      }),
      nextTransaction({
        type: 'expend', amount: 8_400 + (offset + 5) * 350, date: monthDate(anchor, offset, 22),
        categoryId: categoryIds.transport, accountId: accountIds.visa, note: 'Transit and rides',
      }),
      nextTransaction({
        type: 'expend', amount: 4_990, date: monthDate(anchor, offset, 8),
        categoryId: categoryIds.subscriptions, accountId: accountIds.visa,
        recurrenceRuleId: ruleIds.streaming, periodKey: monthlyPeriod, note: 'Streaming subscription',
      }),
      nextTransaction({
        type: 'expend', amount: 18_000, date: monthDate(anchor, offset, 17),
        categoryId: categoryIds.groceries, accountId: accountIds.prepaid, note: 'Lunches',
      }),
      nextTransaction({
        type: 'transfer', amount: 100_000, date: monthDate(anchor, offset, 6),
        accountId: accountIds.checking, counterAccountId: accountIds.savings, note: 'Monthly savings',
      }),
    )
  }

  transactions.push(
    nextTransaction({
      type: 'earn', amount: 175_000, date: monthDate(anchor, -1, 24),
      categoryId: categoryIds.freelance, accountId: accountIds.checking, note: 'Freelance project',
    }),
    nextTransaction({
      type: 'expend', amount: 9_900, date: monthDate(anchor, 0, 3),
      categoryId: categoryIds.health, accountId: accountIds.checking, note: 'Pharmacy',
    }),
    ...installmentAmounts.map((amount, index) => nextTransaction({
      type: 'expend', amount, date: addMonths(monthDate(anchor, -2, 14), index),
      categoryId: categoryIds.shopping, accountId: accountIds.mastercard,
      installmentPlanId: planId, note: `Notebook (${index + 1}/6)`,
    })),
  )

  const cardSettings = [
    { id: accountIds.visa, closingDay: 20, dueDay: 10 },
    { id: accountIds.mastercard, closingDay: 8, dueDay: 15 },
  ]
  const faturaPayments: SeedData['faturaPayments'] = []
  let paymentSequence = 2_000
  for (const card of cardSettings) {
    const currentCycle = cycleKeyFor(anchor, card.closingDay)
    const previousCycle = addMonths(currentCycle, -1)
    const paidCycles = new Set(
      transactions
        .filter((row) => row.accountId === card.id && row.type === 'expend')
        .map((row) => cycleKeyFor(row.date, card.closingDay))
        .filter((cycle) => cycle !== currentCycle && cycle !== previousCycle),
    )
    for (const cycleKey of [...paidCycles].sort()) {
      faturaPayments.push({
        id: uuid(paymentSequence++), userId: SEED_USER_ID, accountId: card.id,
        cycleKey, paidAt: vencimentoFor(cycleKey, card.dueDay),
      })
    }
  }

  return {
    user: {
      id: SEED_USER_ID, name: 'Demo User', email: SEED_EMAIL, emailVerified: true,
      createdAt: seededAt, updatedAt: seededAt,
    },
    authAccount: {
      id: 'local-demo-credential', accountId: SEED_USER_ID, providerId: 'credential',
      userId: SEED_USER_ID, createdAt: seededAt, updatedAt: seededAt,
    },
    categories,
    accounts,
    recurrenceRules,
    recurrenceRuleTags,
    installmentPlans,
    transactions,
    transactionTags,
    faturaPayments,
  }
}
