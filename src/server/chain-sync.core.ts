import { and, between, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, transaction, type Account } from '#/db/schema'
import { CHAINS, dateOf, externalIdOf, parseSpendLog, parseTransferItem, parseTransferLog, planSync, STABLECOINS, type LogMeta, type RawLog, type SpendLog, type SyncKind, type SyncPlan, type TokenTransfer, type TransferItem } from '#/lib/chain-sync'
import { addDays } from '#/lib/dates'
import { RECURRENCE_MATCH_DAYS } from '#/lib/recurrence'
import { listPluggyAccountsCore, RECONNECT_ERROR, syncPluggyAccount } from './pluggy-sync.core'
import { pluggyEnabled } from './pluggy-config'
import type { PluggyWebhookEvent } from './pluggy-webhook'

/**
 * Crypto account sync: explorer + PTAX fetch and db writes. Server-only — import it
 * only from API routes / server-fn handlers (see transactions.core.ts).
 *
 * Source: Blockscout (free PRO key, 5 req/s) — Etherscan V2's free tier does not cover
 * Base or OP. Transfers come from the address-indexed REST `token-transfers` (getLogs by
 * topic on USDC takes ~40s); Spends from the Etherscan-compatible `getLogs` on the
 * emitter. Without BLOCKSCOUT_API_KEY it falls back to the keyless public instances,
 * which allow only ~10 RPC requests per ~hour — local dev only.
 *
 * Base reads a public JSON-RPC node instead: Blockscout PRO's free plan refuses Base (402,
 * "featured chain"), the keyless base.blockscout.com sits behind a Cloudflare challenge
 * (403), and Etherscan V2's free tier refuses Base.
 */
const INSTANCES: Record<number, string> = {
  10: 'https://explorer.optimism.io',
}
// ponytail: Base's public node caps eth_getLogs at 500 blocks (~17 min): a 30-min run is ~4 calls,
// a day of catch-up ~2.5 min, but a months-long backfill runs for hours. Move to a keyed RPC with a
// wider range (Alchemy, Envio HyperRPC, …) if a backfill is needed. Keyless alternatives tested
// 2026-10: drpc/1rpc/blast/tenderly cap at 10–1000 blocks, publicnode/ankr need a token.
const NODES: Record<number, { url: string; range: number }> = {
  8453: { url: 'https://mainnet.base.org', range: 500 },
}
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const CASH_EVENT_EMITTER_OP = '0x380b2e96799405be6e3d965f4044099891881acb'
/** keccak256('Spend(address,bytes32,uint8,address[],uint256[],uint256[],uint256,uint8)') */
const SPEND_TOPIC = '0x244f4cc0665ad7ee4709aa59b30d3ea581cecde1b0430a3f23a5dc609d4890fc'
// ponytail: fixed ~5 min margin behind the node head so the indexer has caught up before the
// cursor skips past a block; an indexer lagging longer loses those logs (read the indexed head then).
const CONFIRMATIONS = 150
const THROTTLE_MS = 30 * 60_000
const PAGE = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Tries `urls` in order, moving on only on 402: the PRO free plan refuses "featured" chains. */
async function getJson(chainId: number, what: string, urls: string[]) {
  // ponytail: fixed pacing + one retry on 429 keeps us under the free rate limit.
  let res: Response | undefined
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await sleep(attempt ? 2_000 : 250)
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (res.status !== 429) break
    }
    if (res!.status !== 402) break
  }
  if (!res?.ok) throw new Error(`explorer ${chainId} ${what}: HTTP ${res?.status}`)
  return res.json()
}

/** Etherscan-compatible RPC (`module=…&action=…`). */
async function rpc(chainId: number, params: Record<string, string>) {
  const key = process.env.BLOCKSCOUT_API_KEY
  const keyless = `${INSTANCES[chainId]}/api?${new URLSearchParams(params)}`
  const body = await getJson(chainId, params.action, key
    ? [`https://api.blockscout.com/v2/api?${new URLSearchParams({ chain_id: String(chainId), ...params, apikey: key })}`, keyless]
    : [keyless])
  if ('jsonrpc' in body) return body.result
  if (body.status === '1') return body.result
  if (/^no (logs|records|transactions) found/i.test(body.message)) return []
  throw new Error(`explorer ${chainId} ${params.action}: ${body.message}${typeof body.result === 'string' ? ` (${body.result})` : ''}`)
}

/** REST v2 (`/api/v2/…`). */
async function rest(chainId: number, path: string, params: Record<string, string>) {
  const key = process.env.BLOCKSCOUT_API_KEY
  const keyless = `${INSTANCES[chainId]}/api/v2${path}?${new URLSearchParams(params)}`
  return getJson(chainId, path.split('/').at(-1)!, key
    ? [`https://api.blockscout.com/${chainId}/api/v2${path}?${new URLSearchParams({ ...params, apikey: key })}`, keyless]
    : [keyless])
}

/** All logs in [fromBlock, toBlock]; a full page re-reads from its last block (ascending order). */
async function getLogs(chainId: number, fromBlock: number, toBlock: number, filter: Record<string, string>): Promise<RawLog[]> {
  const out: RawLog[] = []
  for (let from = fromBlock; ;) {
    const page: RawLog[] = await rpc(chainId, { module: 'logs', action: 'getLogs', fromBlock: String(from), toBlock: String(toBlock), ...filter })
    if (!Array.isArray(page)) throw new Error(`explorer ${chainId}: malformed getLogs response`)
    if (page.length < PAGE) return [...out, ...page]
    const last = Number(page.at(-1)!.blockNumber)
    if (last === from) throw new Error(`explorer ${chainId}: over ${PAGE} logs in block ${last}`)
    out.push(...page.filter((log) => Number(log.blockNumber) < last))
    from = last
  }
}

/** `token` transfers from/to `address` in [fromBlock, toBlock]; pages run newest → oldest. */
async function tokenTransfers(chainId: number, address: string, token: string, fromBlock: number, toBlock: number) {
  const out: TokenTransfer[] = []
  let next: Record<string, string> = {}
  // ponytail: page cap (≈2000 transfers per token per run) so a bot-busy address fails loudly
  // instead of hanging; a personal wallet never gets near it. Raise it, or sync in slices, if needed.
  for (let pages = 0; ; pages++) {
    if (pages === 40) throw new Error(`explorer ${chainId}: over 40 pages of ${token} transfers; choose a later sync start date`)
    const page = await rest(chainId, `/addresses/${address}/token-transfers`, { type: 'ERC-20', token, ...next }) as { items?: TransferItem[]; next_page_params?: Record<string, string | number> | null }
    if (!Array.isArray(page.items)) throw new Error(`explorer ${chainId}: malformed token-transfers response`)
    for (const item of page.items) {
      if (item.block_number >= fromBlock && item.block_number <= toBlock) out.push(parseTransferItem(chainId, token, item))
    }
    if (!page.next_page_params || !page.items.length || page.items.at(-1)!.block_number < fromBlock) return out
    next = Object.fromEntries(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)]))
  }
}

const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
const hex = (n: number) => `0x${n.toString(16)}`

/** JSON-RPC call to the chain's public node (`NODES`). */
async function nodeRpc(chainId: number, method: string, params: unknown[]) {
  let res: Response
  for (let attempt = 0; ; attempt++) {
    await sleep(attempt ? 2_000 : 250)
    res = await fetch(NODES[chainId].url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000),
    })
    if (res.status !== 429 || attempt) break
  }
  const body = await res.json().catch(() => null) as { result?: unknown; error?: { message: string } } | null
  if (!res.ok || !body || body.error) throw new Error(`rpc ${chainId} ${method}: ${body?.error?.message ?? `HTTP ${res.status}`}`)
  return body.result
}

/** Head block and the first block to read for `syncSince`, from the chain's node. */
async function nodeWindow(chainId: number, syncSince: string) {
  const block = await nodeRpc(chainId, 'eth_getBlockByNumber', ['latest', false]) as { number: string; timestamp: string }
  const [head, headTs] = [Number(block.number), Number(block.timestamp)]
  // ponytail: Base's fixed 2 s block time, 1 h early; planSync drops anything before syncSince.
  const start = Math.max(0, head - Math.ceil((headTs - Date.parse(`${syncSince}T00:00:00Z`) / 1000) / 2) - 1800)
  return { head, start }
}

/** Stablecoin `Transfer` logs from/to `address` in [fromBlock, toBlock], read from the chain's node. */
async function nodeTransfers(chainId: number, address: string, fromBlock: number, toBlock: number) {
  const { range } = NODES[chainId]
  const byId = new Map<string, TokenTransfer>()
  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = Math.min(start + range - 1, toBlock)
    // Topic positions AND together, so from and to are two queries.
    for (const topics of [[TRANSFER_TOPIC, topicOf(address)], [TRANSFER_TOPIC, null, topicOf(address)]]) {
      const logs = await nodeRpc(chainId, 'eth_getLogs', [{ fromBlock: hex(start), toBlock: hex(end), address: STABLECOINS[chainId], topics }])
      if (!Array.isArray(logs)) throw new Error(`rpc ${chainId}: malformed getLogs response`)
      for (const log of logs as (RawLog & { address: string; blockTimestamp?: string })[]) {
        if (!log.blockTimestamp) throw new Error(`rpc ${chainId}: log without blockTimestamp`)
        const t = parseTransferLog(chainId, { ...log, timeStamp: log.blockTimestamp })
        byId.set(externalIdOf(t), t) // a self-transfer matches both queries
      }
    }
  }
  return [...byId.values()]
}

async function fetchChain(chainId: number, kind: SyncKind, address: string, fromBlock: number, toBlock: number) {
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  if (NODES[chainId]) transfers.push(...await nodeTransfers(chainId, address, fromBlock, toBlock))
  else for (const token of STABLECOINS[chainId]) transfers.push(...await tokenTransfers(chainId, address, token, fromBlock, toBlock))
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
  if (!acc.walletAddress || !acc.syncKind || acc.syncKind === 'pluggy' || !acc.syncSince) throw new Error('Account is not configured for crypto sync')
  const { walletAddress, syncKind, syncSince } = acc
  const cursor = { ...acc.syncCursor }
  const transfers: TokenTransfer[] = [], spends: SpendLog[] = []
  for (const chainId of CHAINS[syncKind]) {
    const node = NODES[chainId] ? await nodeWindow(chainId, syncSince) : null
    const head = node ? node.head : Number(await rpc(chainId, { module: 'block', action: 'eth_block_number' }))
    if (!Number.isSafeInteger(head)) throw new Error(`explorer ${chainId}: malformed block number`)
    const toBlock = head - CONFIRMATIONS
    const fromBlock = cursor[chainId] != null
      ? cursor[chainId] + 1
      : node ? node.start
      : Number((await rpc(chainId, { module: 'block', action: 'getblocknobytime', timestamp: String(Date.parse(`${syncSince}T00:00:00Z`) / 1000), closest: 'before' })).blockNumber)
    if (!Number.isSafeInteger(fromBlock)) throw new Error(`explorer ${chainId}: malformed start block`)
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
    const existing = await db.select({ id: transaction.id, type: transaction.type, amount: transaction.amount, date: transaction.date, recurrenceRuleId: transaction.recurrenceRuleId }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.accountId, acc.id), isNull(transaction.externalId),
      inArray(transaction.type, ['earn', 'expend']), between(transaction.date, addDays(first, -RECURRENCE_MATCH_DAYS), addDays(last, RECURRENCE_MATCH_DAYS)),
    ))
    const transfersIn = await db.select({ amount: transaction.amount, usdAmount: transaction.usdAmount, date: transaction.date }).from(transaction).where(and(
      eq(transaction.userId, acc.userId), eq(transaction.counterAccountId, acc.id), eq(transaction.type, 'transfer'),
      between(transaction.date, addDays(first, -1), addDays(last, 1)),
    ))
    plan = planSync({
      account: { id: acc.id, walletAddress, syncKind, syncSince },
      siblings: linked.flatMap((a) => a.id !== acc.id && a.walletAddress && a.syncKind && a.syncKind !== 'pluggy' ? [{ id: a.id, walletAddress: a.walletAddress, syncKind: a.syncKind }] : []),
      transfers: newTransfers, spends: newSpends, rates, transfersIn, existing,
    })
  }

  await db.transaction(async (tx) => {
    if (plan.inserts.length) {
      await tx.insert(transaction).values(plan.inserts.map((r) => ({ ...r, userId: acc.userId })))
        .onConflictDoNothing({ target: [transaction.userId, transaction.externalId] })
    }
    for (const claim of plan.claims) {
      await tx.update(transaction).set({ externalId: claim.externalId, usdAmount: claim.usdAmount, ...claim.actual })
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
  const queue = [...wallets, ...targets.filter((a) => a.syncKind !== 'wallet')]
  // Marked before the first await, so a caller that just claimed sees them as syncing.
  for (const acc of queue) syncing.add(acc.id)
  let walletFailed = false
  try {
    for (const acc of queue) {
      try {
        if (acc.syncKind === 'etherfi_cash' && walletFailed) throw new Error('Carteira vinculada falhou nesta sincronização; tentando de novo depois')
        await (acc.syncKind === 'pluggy' ? syncPluggyAccount(acc, linked) : syncAccount(acc, linked))
      } catch (error) {
        if (acc.syncKind === 'wallet') walletFailed = true
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[sync] account ${acc.id}:`, message)
        await db.update(account).set({ lastSyncError: message.slice(0, 500) }).where(eq(account.id, acc.id))
      }
    }
  } finally {
    for (const acc of queue) syncing.delete(acc.id)
  }
}

// ponytail: in-process set, fine on one Railway instance; move to a DB column if the app scales out.
const syncing = new Set<string>()
export const isSyncing = (accountId: string) => syncing.has(accountId)

/** Crypto and Open Finance accounts: everything with a sync config. */
const syncableAccounts = (userId: string) => db.select().from(account)
  .where(and(eq(account.userId, userId), or(isNotNull(account.walletAddress), isNotNull(account.pluggyAccountId))))

/**
 * Lazy sync on read, throttled per account. Resolves once due accounts are claimed and
 * marked syncing; the explorer + PTAX fetch keeps running in the background. Never throws.
 */
export async function syncDueAccounts(userId: string) {
  try {
    const linked = await syncableAccounts(userId)
    const due: Account[] = []
    for (const acc of linked.filter((a) => a.syncEnabled)) {
      // Claim the slot atomically: throttles retries after failures and keeps concurrent reads from double-fetching.
      const [claimed] = await db.update(account).set({ lastSyncedAt: new Date() }).where(and(
        eq(account.id, acc.id), or(isNull(account.lastSyncedAt), lt(account.lastSyncedAt, new Date(Date.now() - THROTTLE_MS))),
      )).returning({ id: account.id })
      if (claimed) due.push(acc)
    }
    if (due.length) void runSync(due, linked).catch((error) => console.error('[chain-sync] syncDueAccounts:', error))
  } catch (error) {
    console.error('[chain-sync] syncDueAccounts:', error)
  }
}

/** The "Sincronizar" button: this account now (even with auto-sync off). */
export async function syncAccountNowCore(userId: string, accountId: string) {
  const linked = await syncableAccounts(userId)
  const target = linked.find((a) => a.id === accountId)
  if (!target) throw new Error('Synced account not found')
  await runSync([target], linked)
  const [row] = await db.select({ lastSyncError: account.lastSyncError }).from(account).where(eq(account.id, accountId))
  return { error: row?.lastSyncError ?? null }
}

/**
 * Pluggy webhook: a trigger only. Syncs the enabled accounts of the item right away (the
 * 30-min throttle is bypassed, a run already in progress is not); `item/error` records the
 * reconnect hint instead. Never throws.
 */
export async function syncPluggyItemEvent({ event, itemId }: PluggyWebhookEvent) {
  try {
    if (!pluggyEnabled()) return
    const ids = (await listPluggyAccountsCore()).filter((a) => a.itemId === itemId).map((a) => a.id)
    if (!ids.length) return
    const rows = await db.select().from(account).where(and(eq(account.syncKind, 'pluggy'), inArray(account.pluggyAccountId, ids)))
    const targets = rows.filter((a) => a.syncEnabled && !syncing.has(a.id))
    if (event === 'item/error') {
      if (targets.length) await db.update(account).set({ lastSyncError: RECONNECT_ERROR }).where(inArray(account.id, targets.map((a) => a.id)))
      return
    }
    for (const userId of new Set(targets.map((a) => a.userId))) {
      // ponytail: re-reads the user's accounts per event; fine at one user.
      const linked = await syncableAccounts(userId)
      await runSync(targets.filter((a) => a.userId === userId), linked)
    }
  } catch (error) {
    console.error('[pluggy] syncPluggyItemEvent:', error)
  }
}
