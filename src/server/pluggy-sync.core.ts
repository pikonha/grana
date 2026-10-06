import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, faturaPayment, installmentPlan, transaction, type Account } from '#/db/schema'
import { addDays, appToday } from '#/lib/dates'
import { paidByDate } from '#/lib/money'
import { planPluggy, type PluggyAccount, type PluggyTx } from '#/lib/pluggy-sync'
import { createInstallmentPlanCore } from './transactions.core'
import { pluggyEnabled, pluggyItemIds } from './pluggy-config'

/**
 * Open Finance (Pluggy) account sync: Pluggy fetch and db writes. Server-only — import it
 * only from API routes / server-fn handlers (see transactions.core.ts).
 * Design: docs/superpowers/specs/2026-10-02-open-finance-pluggy-design.md.
 */
const API = 'https://api.pluggy.ai'
const WINDOW_DAYS = 30
export const RECONNECT_ERROR = 'Reconecte no Meu Pluggy'
// Item statuses that mean the connection needs the holder (Meu Pluggy refreshes the rest by itself).
const BROKEN_ITEM = new Set(['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT'])

let cached: { key: string; expires: number } | undefined

async function apiKey() {
  if (cached && cached.expires > Date.now()) return cached.key
  const res = await fetch(`${API}/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Pluggy auth: HTTP ${res.status}`)
  const { apiKey: key } = await res.json() as { apiKey: string }
  // The key lasts 2 h; renew a little early.
  cached = { key, expires: Date.now() + 110 * 60_000 }
  return key
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { 'X-API-KEY': await apiKey() }, signal: AbortSignal.timeout(30_000) })
  if (res.status === 401) cached = undefined
  if (!res.ok) throw new Error(`Pluggy ${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export type PluggyRemoteAccount = { id: string; itemId: string; name: string; type: string; number: string | null }

/** Accounts of every configured item (the API has no "list my items" call). */
export async function listPluggyAccountsCore(): Promise<PluggyRemoteAccount[]> {
  const lists = await Promise.all(pluggyItemIds().map((itemId) =>
    get<{ results: PluggyRemoteAccount[] }>('/accounts', { itemId }).then((r) => r.results.map((a) => ({ ...a, itemId })))))
  return lists.flat().map(({ id, itemId, name, type, number }) => ({ id, itemId, name, type, number: number ?? null }))
}

async function fetchTransactions(accountId: string, from: string): Promise<PluggyTx[]> {
  // GET /transactions (page-based) answers 410; v2 pages by cursor, `next` carries it as `after`.
  const out: PluggyTx[] = []
  let after: string | null = null
  do {
    const body: { results: PluggyTx[]; next: string | null } = await get('/v2/transactions', { accountId, dateFrom: from, ...(after ? { after } : {}) })
    out.push(...body.results)
    after = body.next ? new URL(body.next, API).searchParams.get('after') : null
  } while (after)
  return out
}

export async function syncPluggyAccount(acc: Account, linked: Account[]) {
  if (!pluggyEnabled()) throw new Error('Open Finance não configurado')
  if (!acc.pluggyAccountId || acc.syncKind !== 'pluggy' || !acc.syncSince) throw new Error('Account is not configured for Open Finance sync')
  const { pluggyAccountId, syncSince } = acc
  const remote = new Map((await listPluggyAccountsCore()).map((a) => [a.id, a]))
  const itemId = remote.get(pluggyAccountId)?.itemId
  if (!itemId) throw new Error('Conta do Open Finance não encontrada nos itens configurados')
  const item = await get<{ status: string }>(`/items/${itemId}`)
  if (BROKEN_ITEM.has(item.status)) throw new Error(RECONNECT_ERROR)

  const today = appToday()
  const from = [syncSince, addDays(today, -WINDOW_DAYS)].sort().at(-1)!
  const toPluggy = (a: Account): PluggyAccount | null => {
    const itemOf = remote.get(a.pluggyAccountId ?? '')?.itemId
    return itemOf ? { id: a.id, kind: a.kind, itemId: itemOf, closingDay: a.closingDay, dueDay: a.dueDay } : null
  }
  const self = toPluggy(acc)!
  const txs = await fetchTransactions(pluggyAccountId, from)
  // Only a bank account looks at sibling cards (to find where a fatura payment went).
  const siblings = await Promise.all(linked
    .filter((a) => a.id !== acc.id && a.syncKind === 'pluggy' && a.kind === 'credit_card' && acc.kind === 'bank_account')
    .flatMap((a) => toPluggy(a) ?? [])
    .map(async (s) => ({ ...s, txs: await fetchTransactions(linked.find((a) => a.id === s.id)!.pluggyAccountId!, from) })))

  const earliest = addDays(from, -2)
  const existing = await db.select({
    id: transaction.id, type: transaction.type, amount: transaction.amount, date: transaction.date,
    accountId: transaction.accountId, counterAccountId: transaction.counterAccountId, externalId: transaction.externalId, installmentPlanId: transaction.installmentPlanId,
  }).from(transaction).where(and(
    eq(transaction.userId, acc.userId), gte(transaction.date, earliest),
    or(eq(transaction.accountId, acc.id), and(eq(transaction.type, 'transfer'), eq(transaction.counterAccountId, acc.id))),
  ))
  const planRows = await db.select({ planId: installmentPlan.id, count: installmentPlan.count, startDate: installmentPlan.startDate })
    .from(installmentPlan).where(and(eq(installmentPlan.userId, acc.userId), eq(installmentPlan.accountId, acc.id)))
  const rowsOfPlans = planRows.length
    ? await db.select({ id: transaction.id, planId: transaction.installmentPlanId, externalId: transaction.externalId }).from(transaction)
      .where(and(eq(transaction.userId, acc.userId), inArray(transaction.installmentPlanId, planRows.map((p) => p.planId)))).orderBy(asc(transaction.date))
    : []
  const paid = await db.select({ cycleKey: faturaPayment.cycleKey }).from(faturaPayment).where(eq(faturaPayment.accountId, acc.id))

  const plan = planPluggy({
    account: self, txs, siblings, existing,
    plans: planRows.map((p) => ({ id: p.planId, count: p.count, startDate: p.startDate, rows: rowsOfPlans.filter((r) => r.planId === p.planId) })),
    faturaCycleKeys: paid.map((p) => p.cycleKey),
  })

  await db.transaction(async (tx) => {
    for (const p of plan.newPlans) {
      const { id } = await createInstallmentPlanCore(acc.userId, {
        type: 'expend', amount: p.totalAmount, date: p.startDate, account_id: p.accountId, note: p.note, installments: { count: p.count },
      }, tx)
      const rows = await tx.select({ id: transaction.id }).from(transaction).where(eq(transaction.installmentPlanId, id)).orderBy(asc(transaction.date))
      for (const claim of p.claims) {
        await tx.update(transaction).set({ externalId: claim.externalId }).where(and(eq(transaction.id, rows[claim.index].id), eq(transaction.userId, acc.userId), isNull(transaction.externalId)))
      }
    }
    if (plan.inserts.length) {
      await tx.insert(transaction).values(plan.inserts.map((r) => ({ ...r, userId: acc.userId, paid: paidByDate(r.date, today) })))
        .onConflictDoNothing({ target: [transaction.userId, transaction.externalId] })
    }
    for (const claim of plan.claims) {
      await tx.update(transaction).set({ externalId: claim.externalId })
        .where(and(eq(transaction.id, claim.id), eq(transaction.userId, acc.userId), isNull(transaction.externalId)))
    }
    for (const r of plan.repoints) {
      await tx.update(transaction).set({ externalId: r.externalId })
        .where(and(eq(transaction.id, r.id), eq(transaction.userId, acc.userId), eq(transaction.externalId, r.from)))
    }
    if (plan.faturaPayments.length) {
      await tx.insert(faturaPayment).values(plan.faturaPayments.map((f) => ({ ...f, userId: acc.userId }))).onConflictDoNothing()
    }
    // Only if the config this run used is still current.
    await tx.update(account).set({ lastSyncedAt: new Date(), lastSyncError: null }).where(and(
      eq(account.id, acc.id), eq(account.pluggyAccountId, pluggyAccountId), eq(account.syncSince, syncSince),
    ))
  })
  return { inserted: plan.inserts.length, claimed: plan.claims.length + plan.repoints.length }
}
