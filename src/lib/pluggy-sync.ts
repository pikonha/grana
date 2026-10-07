/**
 * Pure mapping + matching for Open Finance (Pluggy) account sync (no I/O). The fetch/db side
 * lives in `#/server/pluggy-sync.core.ts`. See docs/superpowers/specs/2026-10-02-open-finance-pluggy-design.md.
 */
import { addDays, appTime, appToday } from './dates'
import { addMonths } from './installments'
import { cycleKeyFor, vencimentoFor } from './faturas'
import { assertMoney } from './money'

/** A run never reads further back than this, whatever `sync_since` says (older history is hermes/manual). */
export const PLUGGY_WINDOW_DAYS = 30
export const pluggyFloor = (today = appToday()) => addDays(today, -PLUGGY_WINDOW_DAYS)

export type PluggyTx = {
  id: string
  /** ISO timestamp from Pluggy. */
  date: string
  description: string
  /** BRL. Bank: + inflow, − outflow. Card: + charge, − credit. */
  amount: number
  category: string | null
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null; totalAmount?: number | null; purchaseDate?: string | null } | null
}

export type PluggyAccount = { id: string; kind: 'credit_card' | 'bank_account'; itemId: string; closingDay: number | null; dueDay: number | null }
export type ExistingRow = {
  id: string; type: 'earn' | 'expend' | 'transfer'; amount: number; date: string
  accountId: string; counterAccountId: string | null; externalId: string | null; installmentPlanId: string | null
}

export type PluggyInput = {
  account: PluggyAccount
  /** Pluggy transactions of `account` in the sync window. */
  txs: PluggyTx[]
  /** The user's other Pluggy-linked accounts with their transactions in the window. */
  siblings: (PluggyAccount & { txs: PluggyTx[] })[]
  /** Rows of `account` in the window (any external_id), installment rows included. */
  existing: ExistingRow[]
  /** Installment plans of `account`; `rows` ordered by date (installment 1 first). */
  plans: { id: string; count: number; startDate: string; rows: { id: string; externalId: string | null }[] }[]
  /** Fatura cycles of `account` already paid. */
  faturaCycleKeys: string[]
}

export type PluggyRow = {
  externalId: string; type: 'earn' | 'expend' | 'transfer'; amount: number; date: string; time: string | null
  accountId: string; counterAccountId: string | null; note: string | null
}
export type PluggyPlan = {
  inserts: PluggyRow[]
  /** Hermes/manual rows (external_id null) that become the synced row. */
  claims: { id: string; externalId: string }[]
  /** Rows whose pluggy id was recreated: `external_id` moves from `from` to `externalId`. */
  repoints: { id: string; from: string; externalId: string }[]
  /** Plans to create with `createInstallmentPlan`; `claims[].index` is the 0-based row to claim. */
  newPlans: { accountId: string; startDate: string; count: number; totalAmount: number; note: string; claims: { index: number; externalId: string }[] }[]
  faturaPayments: { accountId: string; cycleKey: string; paidAt: string }[]
}

const cents = (brl: number) => assertMoney(Math.round(Math.abs(brl) * 100))

/** Date (and time, when the timestamp carries one) in the app timezone. */
function whenOf(iso: string) {
  if (/T00:00:00(\.0+)?Z$/.test(iso) || !iso.includes('T')) return { date: iso.slice(0, 10), time: null }
  const at = new Date(iso)
  return { date: appToday(at), time: appTime(at) }
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
// Pluggy's category is unreliable here (Nubank/XP payments come as `Transfers`), so the description counts too.
const isCardPayment = (tx: PluggyTx) => /credit card payment/i.test(tx.category ?? '') || /pagamento de fatura/i.test(tx.description)
const isFaturaCredit = (tx: PluggyTx) => tx.amount < 0 && (isCardPayment(tx) || /pagamento recebido|pagamentos validos normais/i.test(tx.description))

export function planPluggy(input: PluggyInput): PluggyPlan {
  const { account } = input
  const plan: PluggyPlan = { inserts: [], claims: [], repoints: [], newPlans: [], faturaPayments: [] }
  const returned = new Set(input.txs.map((t) => `pluggy:${t.id}`))
  const known = new Set([...input.existing.map((r) => r.externalId), ...input.plans.flatMap((p) => p.rows.map((r) => r.externalId))])
  const paidCycles = new Set(input.faturaCycleKeys)
  // Matching pool: unclaimed rows, plus rows whose pluggy id is no longer returned (recreated ids).
  const pool = input.existing.filter((r) => !r.installmentPlanId && (r.externalId === null || (r.externalId.startsWith('pluggy:') && !returned.has(r.externalId))))

  for (const tx of input.txs) {
    const externalId = `pluggy:${tx.id}`
    if (known.has(externalId)) continue
    const { date, time } = whenOf(tx.date)
    const amount = cents(tx.amount)
    const card = account.kind === 'credit_card'
    if (card && isFaturaCredit(tx)) {
      const current = cycleKeyFor(date, account.closingDay!)
      const cycleKey = [1, 2, 3].map((n) => addMonths(current, -n))
        .sort((a, b) => daysBetween(vencimentoFor(a, account.dueDay!), date) - daysBetween(vencimentoFor(b, account.dueDay!), date))[0]
      if (!paidCycles.has(cycleKey)) {
        paidCycles.add(cycleKey)
        // ponytail: a partial payment marks the fatura paid.
        plan.faturaPayments.push({ accountId: account.id, cycleKey, paidAt: date })
      }
      continue
    }
    // A refund lands as `earn` on the card, which reduces that cycle's fatura total.
    const inflow = card ? tx.amount < 0 : tx.amount > 0

    const meta = tx.creditCardMetadata
    if (card && !inflow && meta?.totalInstallments && meta.totalInstallments > 1) {
      const [n, k] = [meta.totalInstallments, meta.installmentNumber ?? 1]
      // Nubank dates each installment by its bill (2/3 of a Sep 13 purchase lands on Oct 1), so
      // date − (k−1) months drifts; the purchase date is the plan start.
      const startDate = meta.purchaseDate ? whenOf(meta.purchaseDate).date : addMonths(date, -(k - 1))
      const near = (p: { count: number; startDate: string }) => p.count === n && daysBetween(p.startDate, startDate) <= 3
      const existingPlan = input.plans.find(near)
      if (existingPlan) {
        const target = existingPlan.rows[k - 1]
        if (target && target.externalId === null) plan.claims.push({ id: target.id, externalId })
        continue
      }
      // ponytail: a plan first seen at k > 1 creates installments 1..k−1 too, even before sync_since.
      const created = plan.newPlans.find(near)
      if (created) created.claims.push({ index: k - 1, externalId })
      else plan.newPlans.push({ accountId: account.id, startDate, count: n, totalAmount: meta.totalAmount ? cents(meta.totalAmount) : amount * n, note: tx.description, claims: [{ index: k - 1, externalId }] })
      continue
    }

    const match = pool
      .filter((r) => r.amount === amount && daysBetween(r.date, date) <= 2 && (inflow
        ? r.accountId === account.id ? r.type === 'earn' : r.type === 'transfer' && r.counterAccountId === account.id
        : r.accountId === account.id && (r.type === 'expend' || r.type === 'transfer')))
      .sort((a, b) => daysBetween(a.date, date) - daysBetween(b.date, date))[0]
    if (match) {
      pool.splice(pool.indexOf(match), 1)
      if (match.externalId === null) plan.claims.push({ id: match.id, externalId })
      else plan.repoints.push({ id: match.id, from: match.externalId, externalId })
      continue
    }

    let type: PluggyRow['type'] = inflow ? 'earn' : 'expend'
    let counterAccountId: string | null = null
    if (account.kind === 'bank_account' && !inflow && isCardPayment(tx)) {
      const cards = input.siblings.filter((s) => s.kind === 'credit_card')
      const target = cards.find((c) => c.txs.some((t) => t.amount < 0 && cents(t.amount) === amount && daysBetween(whenOf(t.date).date, date) <= 3))
        ?? cards.find((c) => c.itemId === account.itemId)
      if (target) { type = 'transfer'; counterAccountId = target.id }
    }
    plan.inserts.push({ externalId, type, amount, date, time, accountId: account.id, counterAccountId, note: tx.description })
  }
  return plan
}
