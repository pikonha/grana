import { and, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { account, faturaPayment, transaction } from '#/db/schema'
import { appToday } from '#/lib/dates'
import { cycleKeyFor, faturaLabel, faturaStatus, nextCycleKey, vencimentoFor } from '#/lib/faturas'
import type { FaturaPaymentInput } from './schemas'

export type FaturaRow = Awaited<ReturnType<typeof listFaturasCore>>[number]

export async function listFaturasCore(userId: string, today: string) {
  const cards = await db.select().from(account).where(
    and(eq(account.userId, userId), eq(account.kind, 'credit_card'), eq(account.prepaid, false)),
  )
  const txs = await db.select().from(transaction).where(and(eq(transaction.userId, userId), eq(transaction.type, 'expend')))
  const payments = await db.select().from(faturaPayment).where(eq(faturaPayment.userId, userId))

  return cards.flatMap((card) => {
    const cardTxs = txs.filter((t) => t.accountId === card.id)
    const totals = new Map<string, number>()
    for (const t of cardTxs) {
      const key = cycleKeyFor(t.date, card.closingDay!)
      totals.set(key, (totals.get(key) ?? 0) + t.amount)
    }
    const currentCycleKey = cycleKeyFor(today, card.closingDay!)
    totals.set(currentCycleKey, totals.get(currentCycleKey) ?? 0)
    const populatedKeys = [...totals.keys()].sort()
    for (let key = populatedKeys[0]; key < populatedKeys.at(-1)!; key = nextCycleKey(key)) {
      totals.set(key, totals.get(key) ?? 0)
    }
    const paidKeys = new Set(payments.filter((p) => p.accountId === card.id).map((p) => p.cycleKey))
    return [...totals.entries()].map(([cycleKey, total]) => {
      const vencimento = vencimentoFor(cycleKey, card.dueDay!)
      return {
        accountId: card.id, accountName: card.name, closingDay: card.closingDay!,
        cycleKey, isCurrent: cycleKey === currentCycleKey, total, vencimento,
        label: faturaLabel(vencimento),
        status: faturaStatus({ cycleKey, currentCycleKey, vencimento, today, paid: paidKeys.has(cycleKey) }),
      }
    })
  }).sort((a, b) => b.vencimento.localeCompare(a.vencimento))
}

export async function markFaturaPaidCore(userId: string, data: FaturaPaymentInput) {
  const [card] = await db.select({ kind: account.kind, prepaid: account.prepaid, closingDay: account.closingDay }).from(account).where(
    and(eq(account.id, data.account_id), eq(account.userId, userId)),
  )
  if (!card) throw new Error('One or more accounts do not exist')
  if (card.kind !== 'credit_card' || card.prepaid) throw new Error('Faturas exist only for limit-based credit cards')
  // A cycle key is the ISO date of the card's closing day; anything else is not a real cycle.
  if (Number(data.cycle_key.slice(8)) !== card.closingDay) throw new Error('cycle_key must fall on the card closing day')
  await db.insert(faturaPayment).values({
    userId, accountId: data.account_id, cycleKey: data.cycle_key, paidAt: data.paid_at ?? appToday(),
  }).onConflictDoNothing()
  return { success: true }
}

export async function unmarkFaturaPaidCore(userId: string, data: FaturaPaymentInput) {
  await db.delete(faturaPayment).where(and(
    eq(faturaPayment.userId, userId), eq(faturaPayment.accountId, data.account_id), eq(faturaPayment.cycleKey, data.cycle_key),
  ))
  return { success: true }
}
