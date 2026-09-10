import { afterEach, describe, it, expect, vi } from 'vitest'
import { appMonthKey, appToday } from './dates'
import {
  assertMoney,
  balanceOf,
  formatCentsBRL,
  parseMoneyInputToCents,
  signedAmount,
} from './money'
import { splitInstallments, addMonths } from './installments'
import {
  advance,
  localMonthKey,
  periodKey,
  scheduledDatesInMonth,
  shiftMonth,
} from './recurrence'

describe('assertMoney', () => {
  it('accepts non-negative integers', () => {
    expect(assertMoney(0)).toBe(0)
    expect(assertMoney(1099)).toBe(1099)
  })
  it('rejects floats', () => {
    expect(() => assertMoney(10.99)).toThrow()
    expect(() => assertMoney(0.1)).toThrow()
  })
  it('rejects non-numbers and negatives', () => {
    expect(() => assertMoney('100' as unknown)).toThrow()
    expect(() => assertMoney(NaN)).toThrow()
    expect(() => assertMoney(-5)).toThrow()
  })
})

describe('balance', () => {
  it('signs by type', () => {
    expect(signedAmount('earn', 100)).toBe(100)
    expect(signedAmount('expend', 100)).toBe(-100)
  })
  it('balance is sum of signed rows', () => {
    expect(
      balanceOf([
        { type: 'earn', amount: 5000 },
        { type: 'expend', amount: 1200 },
        { type: 'expend', amount: 800 },
      ]),
    ).toBe(3000)
  })
})

describe('money input mask helpers', () => {
  it('parses typed and pasted BRL text to integer cents', () => {
    expect(parseMoneyInputToCents('1234')).toBe(1234)
    expect(parseMoneyInputToCents('R$ 1.234,56')).toBe(123456)
    expect(parseMoneyInputToCents('')).toBeNull()
  })

  it('formats integer cents as BRL', () => {
    expect(formatCentsBRL(1234).replace(/\s/g, ' ')).toBe('R$ 12,34')
  })
})

describe('splitInstallments', () => {
  it('splits evenly when divisible', () => {
    expect(splitInstallments(1200, 3)).toEqual([400, 400, 400])
  })
  it('last row absorbs the remainder; sum === total', () => {
    const rows = splitInstallments(1000, 3) // 333,333,334
    expect(rows).toEqual([333, 333, 334])
    expect(rows.reduce((a, b) => a + b, 0)).toBe(1000)
  })
  it('rejects bad count', () => {
    expect(() => splitInstallments(1000, 0)).toThrow()
  })
})

describe('addMonths', () => {
  it('advances whole months', () => {
    expect(addMonths('2026-01-15', 0)).toBe('2026-01-15')
    expect(addMonths('2026-01-15', 2)).toBe('2026-03-15')
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10')
  })
})

describe('periodKey', () => {
  it('daily → YYYY-MM-DD', () => {
    expect(periodKey('daily', '2026-06-28')).toBe('2026-06-28')
  })
  it('weekly → Monday of the week', () => {
    // 2026-06-28 is a Sunday → Monday is 2026-06-22
    expect(periodKey('weekly', '2026-06-28')).toBe('2026-06-22')
    // 2026-06-22 is the Monday itself
    expect(periodKey('weekly', '2026-06-22')).toBe('2026-06-22')
  })
  it('monthly → YYYY-MM', () => {
    expect(periodKey('monthly', '2026-06-28')).toBe('2026-06')
  })
  it('yearly → YYYY', () => {
    expect(periodKey('yearly', '2026-06-28')).toBe('2026')
  })
})

describe('advance', () => {
  it('advances each interval', () => {
    expect(advance('daily', '2026-06-28')).toBe('2026-06-29')
    expect(advance('weekly', '2026-06-22')).toBe('2026-06-29')
    expect(advance('monthly', '2026-06-15')).toBe('2026-07-15')
    expect(advance('yearly', '2026-06-15')).toBe('2027-06-15')
  })
})

describe('transaction month navigation', () => {
  it('can move into an empty next month', () => {
    expect(shiftMonth('2026-07', 1)).toBe('2026-08')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('uses the local calendar month instead of UTC', () => {
    expect(localMonthKey(new Date(2026, 6, 31, 23, 30))).toBe('2026-07')
  })
})

describe('scheduled recurrence projection', () => {
  it('shows a monthly earning scheduled for next month', () => {
    expect(scheduledDatesInMonth('monthly', '2026-08-05', '2026-08')).toEqual([
      '2026-08-05',
    ])
  })

  it('projects pending daily occurrences without duplicating prior months', () => {
    expect(scheduledDatesInMonth('daily', '2026-08-30', '2026-08')).toEqual([
      '2026-08-30',
      '2026-08-31',
    ])
    expect(scheduledDatesInMonth('daily', '2026-08-30', '2026-07')).toEqual([])
  })
})

describe('app timezone dates', () => {
  afterEach(() => vi.useRealTimers())
  it('uses the app timezone, not UTC, near midnight', () => {
    vi.useFakeTimers()
    // 2026-01-01T02:00Z is still 2025-12-31 23:00 in America/Sao_Paulo (UTC-3).
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'))
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(appToday()).toBe('2025-12-31')
    expect(appMonthKey()).toBe('2025-12')
  })
  it('agrees with UTC mid-day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))
    expect(appToday()).toBe('2026-07-11')
    expect(appMonthKey()).toBe('2026-07')
  })
})
