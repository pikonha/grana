import { describe, expect, it } from 'vitest'
import { balanceOf, isPaymentTrackable, paidByDate, signedAmount } from './money'

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
