/**
 * Pure mapping + matching for crypto account sync (no I/O). The fetch/db side
 * lives in `#/server/chain-sync.core.ts`. See docs/superpowers/specs/2026-09-24-crypto-sync-design.md.
 */
import { appToday } from './dates'
import { assertMoney } from './money'
import { DEFAULT_TRANSFER_NOTE } from './transaction-labels'

export type SyncKind = 'wallet' | 'etherfi_cash'

/** One ERC20 `Transfer`, Etherscan `tokentx`-shaped (addresses lowercase). */
export type TokenTransfer = {
  chainId: number; hash: string; logIndex: number; blockNumber: number; timeStamp: number
  from: string; to: string; contractAddress: string; value: string
}
/** One ether.fi `Spend` log; `totalUsdAmt` is raw 6-decimal USD. */
export type SpendLog = { chainId: number; hash: string; logIndex: number; blockNumber: number; timeStamp: number; totalUsdAmt: string }

export type PlanInput = {
  account: { id: string; walletAddress: string; syncKind: SyncKind; syncSince: string }
  /** The user's other crypto accounts. */
  siblings: { id: string; walletAddress: string }[]
  transfers: TokenTransfer[]
  spends: SpendLog[]
  /** BRL per USD (PTAX venda) by YYYY-MM-DD; business days only. */
  rates: Record<string, number>
  /** Transfers into this account (for ether.fi top-up dedupe). */
  transfersIn: { amount: number; usdAmount: number | null; date: string }[]
  /** Unclaimed (`external_id IS NULL`) earn/expend rows of this account. */
  existing: { id: string; type: 'earn' | 'expend' | 'transfer'; amount: number; date: string }[]
}

export type SyncRow = {
  externalId: string; type: 'earn' | 'expend' | 'transfer'; amount: number; usdAmount: number
  date: string; accountId: string; counterAccountId: string | null; note: string | null
}
export type SyncPlan = { inserts: SyncRow[]; claims: { id: string; externalId: string; usdAmount: number }[] }

export const ETHERFI_NOTE = 'ether.fi Cash'

/** Allowlisted stablecoins (USD value = token amount, 6 decimals) by chain id: USDC, USDT. */
export const STABLECOINS: Record<number, string[]> = {
  8453: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'],
  10: ['0x0b2c639c533813f4aa9d7837caf62653d097ff85', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'],
}

/** Raw 6-decimal amount → USD cents, rounded half up. */
export function usdCentsOf(raw: string): number {
  return Number((BigInt(raw) + 5_000n) / 10_000n)
}

/** PTAX for `date`, falling back to the last business day before it (weekends, holidays, not-yet-published today). */
export function ptaxFor(date: string, rates: Record<string, number>): number {
  const day = new Date(`${date}T00:00:00Z`)
  for (let i = 0; i < 10; i++) {
    const rate = rates[day.toISOString().slice(0, 10)]
    if (rate) return rate
    day.setUTCDate(day.getUTCDate() - 1)
  }
  throw new Error(`No PTAX rate on or before ${date}`)
}

export const toBrlCents = (usdCents: number, rate: number) => assertMoney(Math.round(usdCents * rate))

export const dateOf = (timeStamp: number) => appToday(new Date(timeStamp * 1000))
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
const isStablecoin = (t: TokenTransfer) => STABLECOINS[t.chainId]?.includes(t.contractAddress.toLowerCase()) ?? false

const within = (a: number, b: number, ratio: number) => Math.abs(a - b) <= ratio * Math.max(a, b)

/** Incoming bridge leg of a top-up already recorded as a transfer into this account (±1 day, ±1% for bridge fees). */
function isBridgedTopUp(earn: SyncRow, transfersIn: PlanInput['transfersIn']) {
  return transfersIn.some((t) => daysBetween(t.date, earn.date) <= 1 &&
    (t.usdAmount != null ? within(t.usdAmount, earn.usdAmount, 0.01) : within(t.amount, earn.amount, 0.01)))
}

export function planSync(input: PlanInput): SyncPlan {
  const { account, rates } = input
  const me = account.walletAddress.toLowerCase()
  const row = (e: { chainId: number; hash: string; logIndex: number; timeStamp: number }, type: SyncRow['type'], usdAmount: number, extra: Partial<SyncRow> = {}): SyncRow => {
    const date = dateOf(e.timeStamp)
    return {
      externalId: `${e.chainId}:${e.hash}:${e.logIndex}`, type, amount: toBrlCents(usdAmount, ptaxFor(date, rates)),
      usdAmount: assertMoney(usdAmount), date, accountId: account.id, counterAccountId: null, note: null, ...extra,
    }
  }

  const sibling = new Map(input.siblings.map((s) => [s.walletAddress.toLowerCase(), s.id]))
  const inWindow = (e: { timeStamp: number }) => dateOf(e.timeStamp) >= account.syncSince
  const rows: SyncRow[] = []
  for (const t of input.transfers.filter((t) => isStablecoin(t) && inWindow(t))) {
    const usd = usdCentsOf(t.value), from = t.from.toLowerCase(), to = t.to.toLowerCase()
    if (from === to) continue
    if (account.syncKind === 'etherfi_cash') {
      // Outgoing = settlement leg of a Spend (counted via the Spend log). Incoming from a
      // sibling = top-up, recorded as a transfer by that account's own sync.
      if (to !== me || sibling.has(from)) continue
      const earn = row(t, 'earn', usd)
      if (!isBridgedTopUp(earn, input.transfersIn)) rows.push(earn)
    } else if (to === me) rows.push(row(t, 'earn', usd))
    else if (from === me) {
      const counter = sibling.get(to)
      rows.push(counter ? row(t, 'transfer', usd, { counterAccountId: counter, note: DEFAULT_TRANSFER_NOTE }) : row(t, 'expend', usd))
    }
  }
  if (account.syncKind === 'etherfi_cash') {
    for (const s of input.spends.filter(inWindow)) rows.push(row(s, 'expend', usdCentsOf(s.totalUsdAmt), { note: ETHERFI_NOTE }))
  }
  return matchExisting(rows, input.existing)
}

/**
 * A synced earn/expend that hermes or the user already entered (same type, ±2 days,
 * ±3% of the converted amount) claims that row instead of inserting; the row keeps
 * its amount, note and tags. Closest amount wins, then closest date.
 */
function matchExisting(rows: SyncRow[], existing: PlanInput['existing']): SyncPlan {
  const pool = [...existing]
  const plan: SyncPlan = { inserts: [], claims: [] }
  for (const r of rows) {
    const best = r.type === 'transfer' ? undefined : pool
      .filter((e) => e.type === r.type && daysBetween(e.date, r.date) <= 2 && Math.abs(e.amount - r.amount) <= 0.03 * r.amount)
      .sort((a, b) => Math.abs(a.amount - r.amount) - Math.abs(b.amount - r.amount) || daysBetween(a.date, r.date) - daysBetween(b.date, r.date))[0]
    if (!best) { plan.inserts.push(r); continue }
    pool.splice(pool.indexOf(best), 1)
    plan.claims.push({ id: best.id, externalId: r.externalId, usdAmount: r.usdAmount })
  }
  return plan
}
