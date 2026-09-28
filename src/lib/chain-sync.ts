/**
 * Pure mapping + matching for crypto account sync (no I/O). The fetch/db side
 * lives in `#/server/chain-sync.core.ts`. See docs/superpowers/specs/2026-09-24-crypto-sync-design.md.
 */
import { addDays, appToday } from './dates'
import { assertMoney } from './money'
import { DEFAULT_TRANSFER_NOTE } from './transaction-labels'

export type SyncKind = 'wallet' | 'etherfi_cash'

/**
 * Chains fetched per kind. ponytail: the Safe is Base-only; ether.fi bridges every Base
 * deposit to the OP safe (same address, arriving from TopUpDest), so its Base leg is
 * skipped to avoid counting a top-up twice.
 */
export const CHAINS: Record<SyncKind, number[]> = { wallet: [8453], etherfi_cash: [10] }

/** Where a log sits on chain; `<chainId>:<hash>:<logIndex>` is its external_id. */
export type LogMeta = { chainId: number; hash: string; logIndex: number; blockNumber: number; timeStamp: number }
/** One allowlist-agnostic ERC20 `Transfer` (addresses lowercase, raw `value`). */
export type TokenTransfer = LogMeta & { from: string; to: string; contractAddress: string; value: string }
/** One ether.fi `Spend` log; `totalUsdAmt` is raw 6-decimal USD. */
export type SpendLog = LogMeta & { totalUsdAmt: string }

export type PlanInput = {
  account: { id: string; walletAddress: string; syncKind: SyncKind; syncSince: string }
  /** The user's other crypto accounts. */
  siblings: { id: string; walletAddress: string; syncKind: SyncKind }[]
  /** Already filtered to events whose external_id is not in the db yet. */
  transfers: TokenTransfer[]
  spends: SpendLog[]
  /** BRL per USD (PTAX venda) by YYYY-MM-DD; business days only. */
  rates: Record<string, number>
  /** Transfers into this account (top-up dedupe). */
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

/**
 * Counterparties whose moves are internal to the account, ignored both ways: ether.fi
 * Lend (OP) — lent funds still count as card balance. ponytail: yield is not imported.
 */
export const INTERNAL_COUNTERPARTIES: Record<number, string[]> = {
  10: ['0x01f8cdfb1694ea8fe4ed6c38a0fd78d1188e03f4'],
}

/** Notes for earns from known ether.fi senders (OP), so refunds and cashback are recognizable. */
export const SENDER_NOTES: Record<number, Record<string, string>> = {
  10: {
    '0xf6b3422e3cc70fa9fce4fab9a706ed2497c7bb9e': 'ether.fi Cash (reembolso)',
    '0xef55ec694b0b8273967f28627c5bc26f5deea836': 'ether.fi Cash (cashback)',
  },
}

export const externalIdOf = (e: LogMeta) => `${e.chainId}:${e.hash}:${e.logIndex}`

/** An Etherscan/Blockscout `getLogs` result entry (numbers hex-encoded). */
export type RawLog = { blockNumber: string; timeStamp: string; logIndex: string; transactionHash: string; topics: string[]; data: string }

const addressOf = (topic: string) => `0x${topic.slice(26)}`.toLowerCase()
const logMeta = (chainId: number, log: RawLog): LogMeta => ({
  chainId, hash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: Number(log.blockNumber), timeStamp: Number(log.timeStamp),
})

/** A Blockscout REST v2 `token-transfers` item (only the fields used). */
export type TransferItem = {
  block_number: number; log_index: number; timestamp: string; transaction_hash: string
  from: { hash: string }; to: { hash: string }; total: { value: string }
}

/** One ERC20 transfer of `token` (the query filter; the item's token field varies by Blockscout version). */
export const parseTransferItem = (chainId: number, token: string, item: TransferItem): TokenTransfer => ({
  chainId, hash: item.transaction_hash, logIndex: item.log_index, blockNumber: item.block_number,
  timeStamp: Date.parse(item.timestamp) / 1000,
  from: item.from.hash.toLowerCase(), to: item.to.hash.toLowerCase(), contractAddress: token.toLowerCase(), value: BigInt(item.total.value).toString(),
})

/** ether.fi `Spend(address indexed safe, …)`; data words: tokens, amounts, amountInUsd offsets, then totalUsdAmt, mode. */
export const parseSpendLog = (chainId: number, log: RawLog): SpendLog & { safe: string } => ({
  ...logMeta(chainId, log), safe: addressOf(log.topics[1]), totalUsdAmt: BigInt(`0x${log.data.slice(2 + 64 * 3, 2 + 64 * 4)}`).toString(),
})

/** Raw 6-decimal amount → USD cents, rounded half up. */
export function usdCentsOf(raw: string): number {
  return Number((BigInt(raw) + 5_000n) / 10_000n)
}

/**
 * PTAX for `date`, falling back to the last business day before it (weekends, holidays).
 * ponytail: a tx made today before the ~13h bulletin also gets yesterday's rate, for good.
 */
export function ptaxFor(date: string, rates: Record<string, number>): number {
  for (let i = 0; i < 10; i++) {
    const rate = rates[addDays(date, -i)]
    if (rate) return rate
  }
  throw new Error(`No PTAX rate on or before ${date}`)
}

export const toBrlCents = (usdCents: number, rate: number) => assertMoney(Math.round(usdCents * rate))

export const dateOf = (timeStamp: number) => appToday(new Date(timeStamp * 1000))
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
const isStablecoin = (t: TokenTransfer) => STABLECOINS[t.chainId]?.includes(t.contractAddress.toLowerCase()) ?? false

const within = (a: number, b: number, ratio: number) => Math.abs(a - b) <= ratio * Math.max(a, b)

/**
 * Takes the recorded transfer into this account that `earn` is the arrival of
 * (±1 day, ±1% for bridge fees) out of `pool`. One transfer absorbs one arrival.
 */
function takeTopUp(earn: SyncRow, pool: PlanInput['transfersIn']) {
  const i = pool.findIndex((t) => daysBetween(t.date, earn.date) <= 1 &&
    (t.usdAmount != null ? within(t.usdAmount, earn.usdAmount, 0.01) : within(t.amount, earn.amount, 0.01)))
  if (i >= 0) pool.splice(i, 1)
  return i >= 0
}

export function planSync(input: PlanInput): SyncPlan {
  const { account, rates } = input
  const me = account.walletAddress.toLowerCase()
  const row = (e: LogMeta, type: SyncRow['type'], usdAmount: number, extra: Partial<SyncRow> = {}): SyncRow => {
    const date = dateOf(e.timeStamp)
    return {
      externalId: externalIdOf(e), type, amount: toBrlCents(usdAmount, ptaxFor(date, rates)),
      usdAmount: assertMoney(usdAmount), date, accountId: account.id, counterAccountId: null, note: null, ...extra,
    }
  }

  const siblings = new Map(input.siblings.map((s) => [s.walletAddress.toLowerCase(), s]))
  const spendTxs = new Set(input.spends.map((s) => `${s.chainId}:${s.hash}`))
  const topUps = [...input.transfersIn]
  const inWindow = (e: LogMeta) => dateOf(e.timeStamp) >= account.syncSince
  const rows: SyncRow[] = []
  for (const t of input.transfers.filter((t) => isStablecoin(t) && inWindow(t))) {
    const usd = usdCentsOf(t.value), from = t.from.toLowerCase(), to = t.to.toLowerCase()
    if (from === to || usd === 0 || INTERNAL_COUNTERPARTIES[t.chainId]?.some((c) => c === from || c === to)) continue
    if (to === me) {
      // A sibling syncing this chain records the move as its own outgoing transfer.
      const sender = siblings.get(from)
      if (sender && CHAINS[sender.syncKind].includes(t.chainId)) continue
      const earn = row(t, 'earn', usd, { note: SENDER_NOTES[t.chainId]?.[from] ?? null })
      if (!takeTopUp(earn, topUps)) rows.push(earn)
    } else if (from === me) {
      // Settlement leg of a Spend: counted once, via the Spend log.
      if (spendTxs.has(`${t.chainId}:${t.hash}`)) continue
      const receiver = siblings.get(to)
      rows.push(receiver ? row(t, 'transfer', usd, { counterAccountId: receiver.id, note: DEFAULT_TRANSFER_NOTE }) : row(t, 'expend', usd))
    }
  }
  for (const s of input.spends.filter(inWindow)) rows.push(row(s, 'expend', usdCentsOf(s.totalUsdAmt), { note: ETHERFI_NOTE }))
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
