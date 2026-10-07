import { describe, expect, it } from 'vitest'
import { balanceOf, countsInTotal, isOpeningBalance, isPaymentTrackable, paidByDate, prepaidBalanceOf, savingsRate, signedAmount } from './money'

describe('balanceOf', () => {
  it('sums paid transactions only when filtered', () => {
    const all = [
      { type: 'earn' as const, amount: 5000, paid: true },
      { type: 'expend' as const, amount: 2000, paid: true },
      { type: 'earn' as const, amount: 1000, paid: false },
    ]
    const paid = all.filter((tx) => tx.paid)
    expect(balanceOf(paid)).toBe(3000)
    expect(balanceOf(all)).toBe(4000)
  })
})

describe('prepaidBalanceOf summed over accounts (home total)', () => {
  const rows = [
    { type: 'earn' as const, amount: 5000, accountId: 'a', counterAccountId: null },
    { type: 'expend' as const, amount: 1200, accountId: 'b', counterAccountId: null },
    { type: 'transfer' as const, amount: 3000, accountId: 'a', counterAccountId: 'b' },
  ]
  const total = (ids: string[]) => ids.reduce((sum, id) => sum + prepaidBalanceOf(id, rows), 0)
  it('equals balanceOf when every account is included (transfers cancel)', () => {
    expect(total(['a', 'b'])).toBe(balanceOf(rows.filter((r) => r.type !== 'transfer') as Array<{ type: 'earn' | 'expend'; amount: number }>))
  })
  it('counts the transfer leaving an included account for an excluded one', () => {
    expect(total(['a'])).toBe(2000)
  })
})

describe('isPaymentTrackable', () => {
  const accountKind = (id: string) => {
    if (id === 'bank-1') return 'bank_account' as const
    if (id === 'card-1') return 'credit_card' as const
    return undefined
  }

  it('returns true for null account', () => {
    expect(isPaymentTrackable({ type: 'earn', accountId: null }, accountKind)).toBe(true)
  })

  it('returns true for bank_account', () => {
    expect(isPaymentTrackable({ type: 'earn', accountId: 'bank-1' }, accountKind)).toBe(true)
    expect(isPaymentTrackable({ type: 'expend', accountId: 'bank-1' }, accountKind)).toBe(true)
  })

  it('returns false for credit_card (prepaid or not)', () => {
    expect(isPaymentTrackable({ type: 'expend', accountId: 'card-1' }, accountKind)).toBe(false)
  })

  it('returns false for transfer', () => {
    expect(isPaymentTrackable({ type: 'transfer', accountId: null }, accountKind)).toBe(false)
    expect(isPaymentTrackable({ type: 'transfer', accountId: 'bank-1' }, accountKind)).toBe(false)
  })
})

describe('paidByDate', () => {
  const today = '2026-08-11'

  it('seeds paid for a past date', () => {
    expect(paidByDate('2026-08-10', today)).toBe(true)
    expect(paidByDate('2025-12-31', today)).toBe(true)
  })

  it('seeds paid for today', () => {
    expect(paidByDate(today, today)).toBe(true)
  })

  it('seeds unpaid for a future date', () => {
    expect(paidByDate('2026-08-12', today)).toBe(false)
    expect(paidByDate('2026-09-01', today)).toBe(false)
  })
})

describe('signedAmount', () => {
  it('returns positive for earn', () => {
    expect(signedAmount('earn', 1000)).toBe(1000)
  })

  it('returns negative for expend', () => {
    expect(signedAmount('expend', 1000)).toBe(-1000)
  })
})

describe('opening balance + savings rate', () => {
  it('detects the opening-balance tag case-insensitively', () => {
    expect(isOpeningBalance({ tags: [{ name: ' Saldo Inicial ' }] })).toBe(true)
    expect(isOpeningBalance({ tags: [{ name: 'salário' }] })).toBe(false)
  })
  it('computes savings rate, null without income', () => {
    expect(savingsRate(10000, 7500)).toBe(0.25)
    expect(savingsRate(10000, 12000)).toBe(-0.2)
    expect(savingsRate(0, 500)).toBeNull()
  })
})

describe('countsInTotal', () => {
  it('follows the checkbox, but a postpaid card never counts', () => {
    expect(countsInTotal({ includeInTotal: true, kind: 'bank_account', prepaid: false })).toBe(true)
    expect(countsInTotal({ includeInTotal: false, kind: 'bank_account', prepaid: false })).toBe(false)
    expect(countsInTotal({ includeInTotal: true, kind: 'credit_card', prepaid: true })).toBe(true)
    expect(countsInTotal({ includeInTotal: true, kind: 'credit_card', prepaid: false })).toBe(false)
  })
})
