import { addMonths } from './installments'

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

/** Cycle key = ISO date of the cycle's closing day (start of the cycle). */
export function cycleKeyFor(date: string, closingDay: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const closingThisMonth = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(closingDay).padStart(2, '0')}`
  return d >= closingDay ? closingThisMonth : addMonths(closingThisMonth, -1)
}

/** Fatura total per cycle key. A credit on the card (`earn`: refund/estorno) reduces it; payments are transfers and stay out. */
export function cycleTotals(txs: Array<{ type: string; amount: number; date: string }>, closingDay: number): Map<string, number> {
  const totals = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== 'expend' && t.type !== 'earn') continue
    const key = cycleKeyFor(t.date, closingDay)
    totals.set(key, (totals.get(key) ?? 0) + (t.type === 'earn' ? -t.amount : t.amount))
  }
  return totals
}

export function nextCycleKey(cycleKey: string): string {
  return addMonths(cycleKey, 1)
}

/** Vencimento date for a cycle: dueDay in the month the cycle closes (month after cycleKey). */
export function vencimentoFor(cycleKey: string, dueDay: number): string {
  const next = addMonths(cycleKey, 1)
  const [y, m] = next.split('-').map(Number)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
}

export function faturaLabel(vencimento: string): string {
  const m = Number(vencimento.split('-')[1])
  return MONTHS_PT[m - 1]
}

export type FaturaStatus = 'open' | 'closed' | 'paid' | 'overdue'

export function faturaStatus(args: { cycleKey: string; currentCycleKey: string; vencimento: string; today: string; paid: boolean }): FaturaStatus {
  if (args.paid) return 'paid'
  if (args.cycleKey === args.currentCycleKey) return 'open'
  if (args.today > args.vencimento) return 'overdue'
  return 'closed'
}

/** limit − (open + closed-unpaid) fatura totals for one card; future parcelas beyond an open cycle never appear here. */
export function availableLimit(limit: number, cardFaturas: Array<{ total: number; status: FaturaStatus }>): number {
  return limit - cardFaturas.filter((f) => f.status !== 'paid').reduce((sum, f) => sum + f.total, 0)
}
