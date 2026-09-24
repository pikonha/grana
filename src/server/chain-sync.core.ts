import { and, between, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, transaction, type Account } from '#/db/schema'
import { CHAINS, dateOf, externalIdOf, parseSpendLog, parseTransferLog, planSync, STABLECOINS, type LogMeta, type RawLog, type SpendLog, type SyncKind, type SyncPlan, type TokenTransfer } from '#/lib/chain-sync'
import { addDays } from '#/lib/dates'

/**
 * Crypto account sync: Etherscan + PTAX fetch and db writes. Server-only — import it
 * only from API routes / server-fn handlers (see transactions.core.ts).
 *
 * Source: Etherscan V2 multichain API (`ETHERSCAN_API_KEY`; its free tier does not
 * cover Base or OP, so the key needs a plan that does). Transfers and Spends both come
 * from `getLogs`, since `tokentx` has no logIndex for the external_id.
 */
const CASH_EVENT_EMITTER_OP = '0x380b2e96799405be6e3d965f4044099891881acb'
/** keccak256('Spend(address,bytes32,uint8,address[],uint256[],uint256[],uint256,uint8)') */
const SPEND_TOPIC = '0x244f4cc0665ad7ee4709aa59b30d3ea581cecde1b0430a3f23a5dc609d4890fc'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
// ponytail: fixed ~5 min margin behind the node head so the indexer has caught up before the
// cursor skips past a block; an indexer lagging longer loses those logs (read the indexed head then).
const CONFIRMATIONS = 150
const THROTTLE_MS = 15 * 60_000
const PAGE = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function etherscan(chainId: number, params: Record<string, string>) {
  const key = process.env.ETHERSCAN_API_KEY
  if (!key) throw new Error('ETHERSCAN_API_KEY not set')
  const url = `https://api.etherscan.io/v2/api?${new URLSearchParams({ chainid: String(chainId), ...params, apikey: key })}`
  // ponytail: fixed pacing + one retry on a rate-limit answer keeps us under 3-5 req/s.
  for (let attempt = 0; ; attempt++) {
    await sleep(attempt ? 1_500 : 350)
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`etherscan ${chainId} ${params.action}: HTTP ${res.status}`)
    const body = await res.json()
    if ('jsonrpc' in body) {
      if (body.error) throw new Error(`etherscan ${chainId} ${params.action}: ${body.error.message ?? 'rpc error'}`)
      return body.result
    }
    if (body.status === '1') return body.result
    if (/^no (logs|records|transactions) found/i.test(body.message)) return []
    const detail = typeof body.result === 'string' ? body.result : ''
    if (attempt === 0 && /rate limit/i.test(detail)) continue
    throw new Error(`etherscan ${chainId} ${params.action}: ${body.message}${detail ? ` (${detail})` : ''}`)
  }
}

/** All logs in [fromBlock, toBlock]; a full page re-reads from its last block (ascending order). */
async function getLogs(chainId: number, fromBlock: number, toBlock: number, filter: Record<string, string>): Promise<RawLog[]> {
  const out: RawLog[] = []
  for (let from = fromBlock; ;) {
    const page: RawLog[] = await etherscan(chainId, { module: 'logs', action: 'getLogs', fromBlock: String(from), toBlock: String(toBlock), page: '1', offset: String(PAGE), ...filter })
    if (!Array.isArray(page)) throw new Error(`etherscan ${chainId}: malformed getLogs response`)
    if (page.length < PAGE) return [...out, ...page]
    const last = Number(page.at(-1)!.blockNumber)
    if (last === from) throw new Error(`etherscan ${chainId}: over ${PAGE} logs in block ${last}`)
    out.push(...page.filter((log) => Number(log.blockNumber) < last))
    from = last
  }
}

const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`

async function fetchChain(chainId: number, kind: SyncKind, address: string, fromBlock: number, toBlock: number) {
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  for (const token of STABLECOINS[chainId]) {
    // One query per direction (topic1 = from, topic2 = to).
    for (const n of [1, 2]) {
      const logs = await getLogs(chainId, fromBlock, toBlock, { address: token, topic0: TRANSFER_TOPIC, [`topic0_${n}_opr`]: 'and', [`topic${n}`]: topicOf(address) })
      for (const log of logs) if (log.topics[0] === TRANSFER_TOPIC) transfers.push(parseTransferLog(chainId, token, log))
    }
  }
  // The emitter lives on OP only.
  if (kind === 'etherfi_cash' && chainId === 10) {
    const logs = await getLogs(chainId, fromBlock, toBlock, { address: CASH_EVENT_EMITTER_OP, topic0: SPEND_TOPIC, topic0_1_opr: 'and', topic1: topicOf(address) })
    for (const log of logs) {
      const spend = parseSpendLog(chainId, log)
      if (log.topics[0] === SPEND_TOPIC && spend.safe === address) spends.push(spend)
    }
  }
  return { transfers, spends }
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

async function syncAccount(acc: Account, linked: Account[]) {
  if (!acc.walletAddress || !acc.syncKind || !acc.syncSince) throw new Error('Account is not configured for crypto sync')
  const { walletAddress, syncKind, syncSince } = acc
  const cursor = { ...acc.syncCursor }
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  for (const chainId of CHAINS[syncKind]) {
    const head = Number(await etherscan(chainId, { module: 'proxy', action: 'eth_blockNumber' }))
    if (!Number.isSafeInteger(head)) throw new Error(`etherscan ${chainId}: malformed block number`)
    const toBlock = head - CONFIRMATIONS
    const fromBlock = cursor[chainId] != null
      ? cursor[chainId] + 1
      : Number(await etherscan(chainId, { module: 'block', action: 'getblocknobytime', timestamp: String(Date.parse(`${syncSince}T00:00:00Z`) / 1000), closest: 'before' }))
    if (!Number.isSafeInteger(fromBlock)) throw new Error(`etherscan ${chainId}: malformed start block`)
    if (fromBlock <= toBlock) {
      const found = await fetchChain(chainId, syncKind, walletAddress, fromBlock, toBlock)
      transfers.push(...found.transfers)
      spends.push(...found.spends)
    }
    cursor[chainId] = Math.max(toBlock, cursor[chainId] ?? 0)
  }

  // Drop what is already in the db (an overlapping re-read after a config change), so a
  // re-read event can never claim a second row and trip UNIQUE(user_id, external_id).
  const ids = [...transfers, ...spends].map(externalIdOf)
  const known = new Set<string | null>()
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.select({ id: transaction.externalId }).from(transaction)
      .where(and(eq(transaction.userId, acc.userId), inArray(transaction.externalId, ids.slice(i, i + 1000))))
    rows.forEach((r) => known.add(r.id))
  }
  const fresh = <T extends LogMeta>(events: T[]) => events.filter((e) => !known.has(externalIdOf(e)))
  const [newTransfers, newSpends] = [fresh(transfers), fresh(spends)]

  const dates = [...newTransfers, ...newSpends].map((e) => dateOf(e.timeStamp)).sort()
  let plan: SyncPlan = { inserts: [], claims: [] }
  if (dates.length) {
    const [first, last] = [dates[0], dates.at(-1)!]
    const rates = await fetchPtax(addDays(first, -10), last)
    const existing = await db.select({ id: transaction.id, type: transaction.type, amount: transaction.amount, date: transaction.date }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.accountId, acc.id), isNull(transaction.externalId),
      inArray(transaction.type, ['earn', 'expend']), between(transaction.date, addDays(first, -2), addDays(last, 2)),
    ))
    const transfersIn = await db.select({ amount: transaction.amount, usdAmount: transaction.usdAmount, date: transaction.date }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.counterAccountId, acc.id), eq(transaction.type, 'transfer'),
      between(transaction.date, addDays(first, -1), addDays(last, 1)),
    ))
    plan = planSync({
      account: { id: acc.id, walletAddress, syncKind, syncSince },
      siblings: linked.filter((a) => a.id !== acc.id && a.syncKind).map((a) => ({ id: a.id, walletAddress: a.walletAddress!, syncKind: a.syncKind! })),
      transfers: newTransfers, spends: newSpends, rates, transfersIn, existing,
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
    // Only if the config this run used is still current: an edit mid-run reset the cursor for a new backfill.
    await tx.update(account).set({ syncCursor: cursor, lastSyncedAt: new Date(), lastSyncError: null }).where(and(
      eq(account.id, acc.id), eq(account.walletAddress, walletAddress), eq(account.syncKind, syncKind), eq(account.syncSince, syncSince),
    ))
  })
  return { inserted: plan.inserts.length, claimed: plan.claims.length }
}

/**
 * Sync `targets`, preceded by the user's auto-synced wallets when an ether.fi card is
 * among them: its top-up dedupe needs the Safe's transfer rows recorded first, so a card
 * is skipped (error stored) when a wallet failed in the same run.
 * Each account is all-or-nothing: a failure leaves its cursor and rows untouched.
 */
async function runSync(targets: Account[], linked: Account[]) {
  const needsWallets = targets.some((a) => a.syncKind === 'etherfi_cash')
  const wallets = linked.filter((a) => a.syncKind === 'wallet' && (targets.includes(a) || (needsWallets && a.syncEnabled)))
  let walletFailed = false
  for (const acc of [...wallets, ...targets.filter((a) => a.syncKind !== 'wallet')]) {
    try {
      if (acc.syncKind === 'etherfi_cash' && walletFailed) throw new Error('Carteira vinculada falhou nesta sincronização; tentando de novo depois')
      await syncAccount(acc, linked)
    } catch (error) {
      if (acc.syncKind === 'wallet') walletFailed = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[chain-sync] account ${acc.id}:`, message)
      await db.update(account).set({ lastSyncError: message.slice(0, 500) }).where(eq(account.id, acc.id))
    }
  }
}

const cryptoAccounts = (userId: string) => db.select().from(account)
  .where(and(eq(account.userId, userId), isNotNull(account.walletAddress)))

/** Lazy sync on read, throttled per account. Never throws. */
export async function syncDueAccounts(userId: string) {
  try {
    const linked = await cryptoAccounts(userId)
    const due: Account[] = []
    for (const acc of linked.filter((a) => a.syncEnabled)) {
      // Claim the slot atomically: throttles retries after failures and keeps concurrent reads from double-fetching.
      const [claimed] = await db.update(account).set({ lastSyncedAt: new Date() }).where(and(
        eq(account.id, acc.id), or(isNull(account.lastSyncedAt), lt(account.lastSyncedAt, new Date(Date.now() - THROTTLE_MS))),
      )).returning({ id: account.id })
      if (claimed) due.push(acc)
    }
    if (due.length) await runSync(due, linked)
  } catch (error) {
    console.error('[chain-sync] syncDueAccounts:', error)
  }
}

/** The "Sincronizar" button: this account now (even with auto-sync off). */
export async function syncAccountNowCore(userId: string, accountId: string) {
  const linked = await cryptoAccounts(userId)
  const target = linked.find((a) => a.id === accountId)
  if (!target) throw new Error('Crypto account not found')
  await runSync([target], linked)
  const [row] = await db.select({ lastSyncError: account.lastSyncError }).from(account).where(eq(account.id, accountId))
  return { error: row?.lastSyncError ?? null }
}
