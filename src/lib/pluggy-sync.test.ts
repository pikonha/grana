import { describe, expect, it } from 'vitest'
import { planPluggy, type PluggyInput, type PluggyTx } from './pluggy-sync'

const tx = (over: Partial<PluggyTx> = {}): PluggyTx => ({
  id: 't1', date: '2026-09-20T00:00:00.000Z', description: 'Mercado', amount: -50.5, category: 'Groceries', ...over,
})

const bank = { id: 'nu', kind: 'bank_account' as const, itemId: 'item-nu', closingDay: null, dueDay: null }
const nuCard = { id: 'nucard', kind: 'credit_card' as const, itemId: 'item-nu', closingDay: 1, dueDay: 8 }
const xpCard = { id: 'xpcard', kind: 'credit_card' as const, itemId: 'item-xp', closingDay: 3, dueDay: 8 }

const input = (over: Partial<PluggyInput> = {}): PluggyInput => ({
  account: bank, txs: [], siblings: [], existing: [], plans: [], faturaCycleKeys: [], ...over,
})
const empty = { inserts: [], claims: [], repoints: [], newPlans: [], faturaPayments: [] }

describe('planPluggy — bank account', () => {
  it('inflow → earn, outflow → expend, integer cents, pluggy: external id', () => {
    const plan = planPluggy(input({ txs: [tx({ id: 'a', amount: 1234.56, description: 'Salário' }), tx({ id: 'b', amount: -50.1 })] }))
    expect(plan.inserts).toEqual([
      { externalId: 'pluggy:a', type: 'earn', amount: 123456, date: '2026-09-20', time: null, accountId: 'nu', counterAccountId: null, note: 'Salário' },
      { externalId: 'pluggy:b', type: 'expend', amount: 5010, date: '2026-09-20', time: null, accountId: 'nu', counterAccountId: null, note: 'Mercado' },
    ])
  })

  it('timestamp with a time is converted to São Paulo date + time', () => {
    const [row] = planPluggy(input({ txs: [tx({ date: '2026-09-21T02:30:00.000Z' })] })).inserts
    expect(row).toMatchObject({ date: '2026-09-20', time: '23:30' })
  })

  it('is idempotent: a tx already carrying its external id yields an empty plan', () => {
    const existing = [{ id: 'r1', type: 'expend' as const, amount: 5050, date: '2026-09-20', accountId: 'nu', counterAccountId: null, externalId: 'pluggy:t1', installmentPlanId: null }]
    expect(planPluggy(input({ txs: [tx()], existing }))).toEqual(empty)
  })
})

const row = (over: Partial<PluggyInput['existing'][number]> = {}): PluggyInput['existing'][number] => ({
  id: 'r1', type: 'expend', amount: 5050, date: '2026-09-20', accountId: 'nu', counterAccountId: null, externalId: null, installmentPlanId: null, ...over,
})

describe('planPluggy — matching hermes / manual rows', () => {
  it('claims an unclaimed same-direction, same-amount row within ±2 days instead of inserting', () => {
    const plan = planPluggy(input({ txs: [tx()], existing: [row({ date: '2026-09-22' })] }))
    expect(plan).toEqual({ ...empty, claims: [{ id: 'r1', externalId: 'pluggy:t1' }] })
  })

  it('claims a recurrence occurrence within ±7 days and ±3%, taking the real amount and date', () => {
    const plan = planPluggy(input({ txs: [tx()], existing: [row({ date: '2026-09-15', amount: 5000, recurrenceRuleId: 'rule' })] }))
    expect(plan.claims).toEqual([{ id: 'r1', externalId: 'pluggy:t1', actual: { amount: 5050, date: '2026-09-20', time: null } }])
    expect(plan.inserts).toEqual([])
    const far = planPluggy(input({ txs: [tx()], existing: [row({ date: '2026-09-12', recurrenceRuleId: 'rule' })] }))
    expect(far.claims).toEqual([])
  })

  it('picks the closest date, and one row is claimed only once', () => {
    const existing = [row({ id: 'far', date: '2026-09-22' }), row({ id: 'near', date: '2026-09-21' })]
    const plan = planPluggy(input({ txs: [tx({ id: 'a' }), tx({ id: 'b' })], existing }))
    expect(plan.claims).toEqual([{ id: 'near', externalId: 'pluggy:a' }, { id: 'far', externalId: 'pluggy:b' }])
    expect(plan.inserts).toEqual([])
  })

  it.each([
    ['different amount', { amount: 5051 }],
    ['3 days away', { date: '2026-09-23' }],
    ['other direction', { type: 'earn' as const }],
    ['other account', { accountId: 'other' }],
  ])('does not claim a row with %s', (_, over) => {
    const plan = planPluggy(input({ txs: [tx()], existing: [row(over)] }))
    expect(plan.claims).toEqual([])
    expect(plan.inserts).toHaveLength(1)
  })

  it('an outflow claims a transfer out of the account; an inflow a transfer into it', () => {
    const out = planPluggy(input({ txs: [tx()], existing: [row({ type: 'transfer', counterAccountId: 'nucard' })] }))
    expect(out.claims).toHaveLength(1)
    const inn = planPluggy(input({ txs: [tx({ amount: 50.5 })], existing: [row({ type: 'transfer', accountId: 'other', counterAccountId: 'nu' })] }))
    expect(inn.claims).toHaveLength(1)
  })

  it('never claims a row that already has another external id', () => {
    const plan = planPluggy(input({ txs: [tx()], existing: [row({ externalId: 'pluggy:zzz' })] }))
    expect(plan.claims).toEqual([])
  })

  it('a recreated pluggy id (old id no longer returned) re-points the row instead of inserting', () => {
    const plan = planPluggy(input({ txs: [tx({ id: 'new' })], existing: [row({ externalId: 'pluggy:old' })] }))
    expect(plan).toEqual({ ...empty, repoints: [{ id: 'r1', from: 'pluggy:old', externalId: 'pluggy:new' }] })
  })

  it('a pluggy-claimed row whose id is still returned is not up for re-pointing', () => {
    const plan = planPluggy(input({ txs: [tx({ id: 'a' }), tx({ id: 'b' })], existing: [row({ externalId: 'pluggy:a' })] }))
    expect(plan.repoints).toEqual([])
    expect(plan.inserts.map((r) => r.externalId)).toEqual(['pluggy:b'])
  })
})

describe('planPluggy — bank card payment', () => {
  const payment = tx({ id: 'pay', amount: -800, category: 'Credit card payment', description: 'Pagamento fatura' })

  it('→ transfer to the linked card that received a credit of the same amount within ±3 days', () => {
    const siblings = [
      { ...nuCard, txs: [tx({ id: 'c1', amount: -800, date: '2026-09-10T00:00:00.000Z' })] },
      { ...xpCard, txs: [tx({ id: 'c2', amount: -800, date: '2026-09-21T00:00:00.000Z' })] },
    ]
    const [row] = planPluggy(input({ txs: [payment], siblings })).inserts
    expect(row).toMatchObject({ type: 'transfer', accountId: 'nu', counterAccountId: 'xpcard', amount: 80000 })
  })

  it('→ else transfer to the linked card of the same item', () => {
    const siblings = [{ ...xpCard, txs: [] }, { ...nuCard, txs: [] }]
    expect(planPluggy(input({ txs: [payment], siblings })).inserts[0]).toMatchObject({ type: 'transfer', counterAccountId: 'nucard' })
  })

  it('→ else expend, since the card purchases are not tracked in grana', () => {
    const siblings = [{ ...xpCard, txs: [] }]
    expect(planPluggy(input({ txs: [payment], siblings })).inserts[0]).toMatchObject({ type: 'expend', counterAccountId: null })
  })

  it('is recognized by description when Pluggy categorizes it as Transfers (Nubank, XP)', () => {
    const nubank = tx({ id: 'pay', amount: -800, category: 'Transfers', description: 'Pagamento de fatura' })
    expect(planPluggy(input({ txs: [nubank], siblings: [{ ...nuCard, txs: [] }] })).inserts[0]).toMatchObject({ type: 'transfer', counterAccountId: 'nucard' })
  })
})

describe('planPluggy — credit card', () => {
  const card = (over: Partial<PluggyInput> = {}) => input({ account: nuCard, ...over })
  const parcela = (k: number, over: Partial<PluggyTx> = {}) => tx({
    id: `p${k}`, amount: 100, date: `2026-0${k + 6}-15T00:00:00.000Z`, description: 'Celular',
    creditCardMetadata: { installmentNumber: k, totalInstallments: 10, totalAmount: 1000 }, ...over,
  })

  it('charge → expend; refund → earn', () => {
    const plan = planPluggy(card({ txs: [tx({ id: 'c', amount: 30 }), tx({ id: 'r', amount: -12, category: 'Shopping' })] }))
    expect(plan.inserts.map((r) => [r.type, r.amount])).toEqual([['expend', 3000], ['earn', 1200]])
  })

  it('first sight of an installment purchase creates the plan (start = date − (k−1) months) and claims row k', () => {
    const plan = planPluggy(card({ txs: [parcela(3)] }))
    expect(plan).toEqual({
      ...empty,
      newPlans: [{ accountId: 'nucard', startDate: '2026-07-15', count: 10, totalAmount: 100000, note: 'Celular', claims: [{ index: 2, externalId: 'pluggy:p3' }] }],
    })
  })

  it('starts the plan at purchaseDate when Pluggy has it (Nubank dates installments by bill)', () => {
    // Purchase Sep 13 (20:01 in São Paulo); 2/3 posted Oct 1: date − 1 month would give Sep 1.
    const p2 = parcela(2, { date: '2026-10-01T00:00:00.000Z', creditCardMetadata: { installmentNumber: 2, totalInstallments: 3, purchaseDate: '2026-09-13T23:01:54.001Z' } })
    const plans = [{ id: 'plan', count: 3, startDate: '2026-09-14', rows: [{ id: 'r0', externalId: null }, { id: 'r1', externalId: null }, { id: 'r2', externalId: null }] }]
    expect(planPluggy(card({ txs: [p2], plans }))).toEqual({ ...empty, claims: [{ id: 'r1', externalId: 'pluggy:p2' }] })
  })

  it('total falls back to amount × N when Pluggy has no totalAmount', () => {
    const plan = planPluggy(card({ txs: [parcela(1, { creditCardMetadata: { installmentNumber: 1, totalInstallments: 4 } })] }))
    expect(plan.newPlans[0]).toMatchObject({ count: 4, totalAmount: 40000 })
  })

  it('claims the row of an existing plan with the same count and a start within ±3 days', () => {
    const plans = [{ id: 'plan', count: 10, startDate: '2026-07-17', rows: Array.from({ length: 10 }, (_, i) => ({ id: `row${i}`, externalId: null })) }]
    expect(planPluggy(card({ txs: [parcela(3)], plans }))).toEqual({ ...empty, claims: [{ id: 'row2', externalId: 'pluggy:p3' }] })
  })

  it('does not match a plan of another count or a start 4 days away', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `row${i}`, externalId: null }))
    const plans = [{ id: 'a', count: 12, startDate: '2026-07-15', rows }, { id: 'b', count: 10, startDate: '2026-07-19', rows }]
    expect(planPluggy(card({ txs: [parcela(3)], plans })).newPlans).toHaveLength(1)
  })

  it('is idempotent for installments: the plan row already carries the id', () => {
    const plans = [{ id: 'plan', count: 10, startDate: '2026-07-15', rows: [{ id: 'r0', externalId: null }, { id: 'r1', externalId: null }, { id: 'r2', externalId: 'pluggy:p3' }] }]
    expect(planPluggy(card({ txs: [parcela(3)], plans }))).toEqual(empty)
  })

  it('a payment credit marks the closed cycle with the closest vencimento paid; no transaction', () => {
    // closes day 1, due day 8: Sep cycle (key 2026-09-01) is due Oct 8.
    const pay = tx({ id: 'pg', amount: -900, category: 'Credit card payment', description: 'Pagamento recebido', date: '2026-10-07T00:00:00.000Z' })
    expect(planPluggy(card({ txs: [pay] }))).toEqual({ ...empty, faturaPayments: [{ accountId: 'nucard', cycleKey: '2026-09-01', paidAt: '2026-10-07' }] })
  })

  it('XP card payment credit (Transfers / "Pagamentos Validos Normais") also marks the fatura paid', () => {
    const pay = tx({ id: 'pg', amount: -900, category: 'Transfers', description: 'Pagamentos Validos Normais', date: '2026-10-07T00:00:00.000Z' })
    expect(planPluggy(card({ txs: [pay] }))).toEqual({ ...empty, faturaPayments: [{ accountId: 'nucard', cycleKey: '2026-09-01', paidAt: '2026-10-07' }] })
  })

  it('a payment just after the vencimento still picks that cycle', () => {
    const pay = tx({ id: 'pg', amount: -900, description: 'Pagamento recebido', date: '2026-10-09T00:00:00.000Z' })
    expect(planPluggy(card({ txs: [pay] })).faturaPayments[0].cycleKey).toBe('2026-09-01')
  })

  it('skips a fatura already paid, and pays each cycle once per run', () => {
    const pay = (id: string) => tx({ id, amount: -900, description: 'Pagamento recebido', date: '2026-10-07T00:00:00.000Z' })
    expect(planPluggy(card({ txs: [pay('a')], faturaCycleKeys: ['2026-09-01'] })).faturaPayments).toEqual([])
    expect(planPluggy(card({ txs: [pay('a'), pay('b')] })).faturaPayments).toHaveLength(1)
  })
})
