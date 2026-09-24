import { and, asc, between, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, transaction, type Account } from '#/db/schema'
import { dateOf, planSync, STABLECOINS, type SpendLog, type SyncKind, type SyncPlan, type TokenTransfer } from '#/lib/chain-sync'

/**
 * Crypto account sync: explorer + PTAX fetch and db writes. Server-only — import it
 * only from API routes / server-fn handlers (see transactions.core.ts).
 *
 * Source: Blockscout's Etherscan-compatible API (free PRO key, 5 req/s). Etherscan V2's
 * free tier does not cover Base or OP. Without BLOCKSCOUT_API_KEY it falls back to the
 * keyless public instances, which allow only ~10 requests per window — local dev only.
 */
const INSTANCES: Record<number, string> = {
  8453: 'https://base.blockscout.com/api',
  10: 'https://explorer.optimism.io/api',
}
const explorerUrl = (chainId: number, params: Record<string, string>) => {
  const key = process.env.BLOCKSCOUT_API_KEY
  return key
    ? `https://api.blockscout.com/v2/api?${new URLSearchParams({ chain_id: String(chainId), ...params, apikey: key })}`
    : `${INSTANCES[chainId]}?${new URLSearchParams(params)}`
}
// ponytail: the Safe is Base-only; ether.fi bridges every Base deposit to the OP safe
// (same address, arriving from TopUpDest), so its Base leg is skipped to avoid counting a top-up twice.
const CHAINS: Record<SyncKind, number[]> = { wallet: [8453], etherfi_cash: [10] }
const CASH_EVENT_EMITTER_OP = '0x380b2e96799405be6e3d965f4044099891881acb'
/** keccak256('Spend(address,bytes32,uint8,address[],uint256[],uint256[],uint256,uint8)') */
const SPEND_TOPIC = '0x244f4cc0665ad7ee4709aa59b30d3ea581cecde1b0430a3f23a5dc609d4890fc'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
// ponytail: fixed margin behind head so the explorer has indexed what the cursor skips past.
const CONFIRMATIONS = 30
const THROTTLE_MS = 15 * 60_000
const PAGE = 1000

type RawLog = { blockNumber: string; timeStamp: string; logIndex: string; transactionHash: string; topics: string[]; data: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function explorer(chainId: number, params: Record<string, string>) {
  // ponytail: fixed pacing + one retry on 429 keeps us under the keyless rate limit; add a Blockscout key if it bites.
  let res: Response | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(attempt ? 2_000 : 250)
    res = await fetch(explorerUrl(chainId, params), { signal: AbortSignal.timeout(15_000) })
    if (res.status !== 429) break
  }
  if (!res?.ok) throw new Error(`explorer ${chainId} ${params.action}: HTTP ${res?.status}`)
  const body = await res.json()
  if ('jsonrpc' in body) return body.result
  if (body.status === '1') return body.result
  if (/^no (logs|records|transactions) found/i.test(body.message)) return []
  throw new Error(`explorer ${chainId}: ${body.message}${typeof body.result === 'string' ? ` (${body.result})` : ''}`)
}

/** All logs in [fromBlock, toBlock]; a full page re-reads from its last block (ascending order). */
async function getLogs(chainId: number, fromBlock: number, toBlock: number, filter: Record<string, string>): Promise<RawLog[]> {
  const out: RawLog[] = []
  for (let from = fromBlock; ;) {
    const page: RawLog[] = await explorer(chainId, { module: 'logs', action: 'getLogs', fromBlock: String(from), toBlock: String(toBlock), ...filter })
    if (!Array.isArray(page)) throw new Error(`explorer ${chainId}: malformed getLogs response`)
    if (page.length < PAGE) return [...out, ...page]
    const last = Number(page.at(-1)!.blockNumber)
    if (last === from) throw new Error(`explorer ${chainId}: over ${PAGE} logs in block ${last}`)
    out.push(...page.filter((log) => Number(log.blockNumber) < last))
    from = last
  }
}

const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
const addressOf = (topic: string) => `0x${topic.slice(26)}`.toLowerCase()
const logMeta = (chainId: number, log: RawLog) => ({
  chainId, hash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: Number(log.blockNumber), timeStamp: Number(log.timeStamp),
})

async function fetchChain(chainId: number, kind: SyncKind, address: string, fromBlock: number, toBlock: number) {
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  // ether.fi outgoing transfers are Spend settlements, never counted — only fetch incoming there.
  const directions = kind === 'wallet' ? ['topic1', 'topic2'] : ['topic2']
  for (const token of STABLECOINS[chainId]) {
    for (const topic of directions) {
      const logs = await getLogs(chainId, fromBlock, toBlock, { address: token, topic0: TRANSFER_TOPIC, topic0_1_opr: 'and', topic0_2_opr: 'and', [topic]: topicOf(address) })
      for (const log of logs) {
        if (log.topics[0] !== TRANSFER_TOPIC) continue
        transfers.push({ ...logMeta(chainId, log), from: addressOf(log.topics[1]), to: addressOf(log.topics[2]), contractAddress: token, value: BigInt(log.data).toString() })
      }
    }
  }
  if (kind === 'etherfi_cash' && chainId === 10) {
    const logs = await getLogs(chainId, fromBlock, toBlock, { address: CASH_EVENT_EMITTER_OP, topic0: SPEND_TOPIC, topic0_1_opr: 'and', topic1: topicOf(address) })
    for (const log of logs) {
      if (log.topics[0] !== SPEND_TOPIC || addressOf(log.topics[1]) !== address) continue
      // data words: tokens offset, amounts offset, amountInUsd offset, totalUsdAmt, mode
      spends.push({ ...logMeta(chainId, log), totalUsdAmt: BigInt(`0x${log.data.slice(2 + 64 * 3, 2 + 64 * 4)}`).toString() })
    }
  }
  return { transfers, spends }
}

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** BCB PTAX venda (BRL per USD) for business days in [from, to]. */
async function fetchPtax(from: string, to: string): Promise<Record<string, number>> {
  const bcb = (date: string) => `'${date.slice(5, 7)}-${date.slice(8, 10)}-${date.slice(0, 4)}'`
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial=${bcb(from)}&@dataFinalCotacao=${bcb(to)}&$format=json&$select=cotacaoVenda,dataHoraCotacao`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`PTAX: HTTP ${res.status}`)
  const body = await res.json() as { value?: { cotacaoVenda: number; dataHoraCotacao: string }[] }
  if (!Array.isArray(body.value)) throw new Error('PTAX: malformed response')
  // Several bulletins per day; the last one (closing) wins.
  return Object.fromEntries(body.value.map((r) => [r.dataHoraCotacao.slice(0, 10), r.cotacaoVenda]))
}

async function syncAccount(acc: Account, crypto: Account[]) {
  if (!acc.walletAddress || !acc.syncKind || !acc.syncSince) throw new Error('Account is not configured for crypto sync')
  const { walletAddress, syncKind, syncSince } = acc
  const cursor = { ...acc.syncCursor }
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  for (const chainId of CHAINS[syncKind]) {
    const head = Number(await explorer(chainId, { module: 'block', action: 'eth_block_number' }))
    if (!Number.isSafeInteger(head)) throw new Error(`explorer ${chainId}: malformed block number`)
    const toBlock = head - CONFIRMATIONS
    const fromBlock = cursor[chainId] != null
      ? cursor[chainId] + 1
      : Number((await explorer(chainId, { module: 'block', action: 'getblocknobytime', timestamp: String(Date.parse(`${syncSince}T00:00:00Z`) / 1000), closest: 'before' })).blockNumber)
    if (!Number.isSafeInteger(fromBlock)) throw new Error(`explorer ${chainId}: malformed start block`)
    if (fromBlock <= toBlock) {
      const found = await fetchChain(chainId, syncKind, walletAddress, fromBlock, toBlock)
      transfers.push(...found.transfers)
      spends.push(...found.spends)
    }
    cursor[chainId] = Math.max(toBlock, cursor[chainId] ?? 0)
  }

  const dates = [...transfers, ...spends].map((e) => dateOf(e.timeStamp)).sort()
  let plan: SyncPlan = { inserts: [], claims: [] }
  if (dates.length) {
    const [first, last] = [dates[0], dates.at(-1)!]
    const rates = await fetchPtax(shiftDate(first, -10), last)
    const existing = await db.select({ id: transaction.id, type: transaction.type, amount: transaction.amount, date: transaction.date }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.accountId, acc.id), isNull(transaction.externalId),
      inArray(transaction.type, ['earn', 'expend']), between(transaction.date, shiftDate(first, -2), shiftDate(last, 2)),
    ))
    const transfersIn = await db.select({ amount: transaction.amount, usdAmount: transaction.usdAmount, date: transaction.date }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.counterAccountId, acc.id), eq(transaction.type, 'transfer'),
      between(transaction.date, shiftDate(first, -1), shiftDate(last, 1)),
    ))
    plan = planSync({
      account: { id: acc.id, walletAddress, syncKind, syncSince },
      siblings: crypto.filter((a) => a.id !== acc.id).map((a) => ({ id: a.id, walletAddress: a.walletAddress! })),
      transfers, spends, rates, transfersIn, existing,
    })
  }

  await db.transaction(async (tx) => {
    if (plan.inserts.length) {
      await tx.insert(transaction).values(plan.inserts.map((r) => ({ ...r, userId: acc.userId })))
        .onConflictDoNothing({ target: [transaction.userId, transaction.externalId] })
    }
    for (const claim of plan.claims) {
      await tx.update(transaction).set({ externalId: claim.externalId, usdAmount: claim.usdAmount })
        .where(and(eq(transaction.id, claim.id), eq(transaction.userId, acc.userId), isNull(transaction.externalId)))
    }
    await tx.update(account).set({ syncCursor: cursor, lastSyncedAt: new Date(), lastSyncError: null }).where(eq(account.id, acc.id))
  })
  return { inserted: plan.inserts.length, claimed: plan.claims.length }
}

/**
 * Sync `accounts` in order. Each one is all-or-nothing: any fetch/plan failure leaves
 * its cursor and rows untouched and stores the error for the UI.
 */
async function runSync(accounts: Account[], crypto: Account[]) {
  for (const acc of accounts) {
    try {
      await syncAccount(acc, crypto)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[chain-sync] account ${acc.id}:`, message)
      await db.update(account).set({ lastSyncError: message.slice(0, 500) }).where(eq(account.id, acc.id))
    }
  }
}

const cryptoAccounts = (userId: string) => db.select().from(account)
  .where(and(eq(account.userId, userId), isNotNull(account.walletAddress)))
  // Wallets first: a Safe → ether.fi top-up must exist as a transfer before ether.fi dedupes against it.
  .orderBy(asc(account.syncKind))

/** Lazy sync on read, throttled per account. Never throws. */
export async function syncDueAccounts(userId: string) {
  try {
    const crypto = await cryptoAccounts(userId)
    const due: Account[] = []
    for (const acc of crypto.filter((a) => a.syncEnabled)) {
      // Claim the slot atomically: throttles retries after failures and keeps concurrent reads from double-fetching.
      const [claimed] = await db.update(account).set({ lastSyncedAt: new Date() }).where(and(
        eq(account.id, acc.id), or(isNull(account.lastSyncedAt), lt(account.lastSyncedAt, new Date(Date.now() - THROTTLE_MS))),
      )).returning({ id: account.id })
      if (claimed) due.push(acc)
    }
    await runSync(due, crypto)
  } catch (error) {
    console.error('[chain-sync] syncDueAccounts:', error)
  }
}

/** The "Sincronizar" button: this account now, after the user's auto-synced wallets when it is an ether.fi card. */
export async function syncAccountNowCore(userId: string, accountId: string) {
  const crypto = await cryptoAccounts(userId)
  const target = crypto.find((a) => a.id === accountId)
  if (!target) throw new Error('Crypto account not found')
  const before = target.syncKind === 'etherfi_cash' ? crypto.filter((a) => a.syncKind === 'wallet' && a.syncEnabled) : []
  await runSync([...before, target], crypto)
  const [row] = await db.select({ lastSyncError: account.lastSyncError }).from(account).where(eq(account.id, accountId))
  return { error: row?.lastSyncError ?? null }
}
