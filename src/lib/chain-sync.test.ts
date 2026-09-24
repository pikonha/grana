import { describe, expect, it } from 'vitest'
import { planSync, type PlanInput } from './chain-sync'

const SAFE = '0x1111111111111111111111111111111111111111'
const ETHERFI = '0x2222222222222222222222222222222222222222'
const OTHER = '0x9999999999999999999999999999999999999999'
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85'

// 2026-09-22 12:00 in São Paulo (UTC-3).
const TUE_NOON = Date.parse('2026-09-22T15:00:00Z') / 1000
const DAY = 86_400

const transfer = (over: Partial<PlanInput['transfers'][number]> = {}): PlanInput['transfers'][number] => ({
  chainId: 8453, hash: '0xaaa', logIndex: 3, blockNumber: 100, timeStamp: TUE_NOON,
  from: OTHER, to: SAFE, contractAddress: USDC_BASE, value: '100000000', // 100 USDC
  ...over,
})

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  account: { id: 'safe', walletAddress: SAFE, syncKind: 'wallet', syncSince: '2026-09-01' },
  siblings: [],
  transfers: [],
  spends: [],
  rates: { '2026-09-22': 5.25 },
  transfersIn: [],
  existing: [],
  ...over,
})

describe('planSync — wallet', () => {
  it('imports an incoming stablecoin transfer as an earn in BRL cents', () => {
    const plan = planSync(base({ transfers: [transfer()] }))
    expect(plan.inserts).toEqual([{
      externalId: '8453:0xaaa:3', type: 'earn', amount: 52500, usdAmount: 10000,
      date: '2026-09-22', accountId: 'safe', counterAccountId: null, note: null,
    }])
    expect(plan.claims).toEqual([])
  })

  it('imports an outgoing transfer to a stranger as an expend', () => {
    const plan = planSync(base({ transfers: [transfer({ from: SAFE, to: OTHER })] }))
    expect(plan.inserts).toMatchObject([{ type: 'expend', amount: 52500, counterAccountId: null }])
  })

  it('imports an outgoing transfer to another crypto account of the user as one transfer', () => {
    const plan = planSync(base({
      siblings: [{ id: 'etherfi', walletAddress: ETHERFI }],
      transfers: [transfer({ from: SAFE, to: ETHERFI })],
    }))
    expect(plan.inserts).toMatchObject([{ type: 'transfer', accountId: 'safe', counterAccountId: 'etherfi', note: 'Transferência' }])
  })

  it('ignores non-stablecoin tokens and movements before sync_since', () => {
    const plan = planSync(base({
      transfers: [
        transfer({ contractAddress: '0x4200000000000000000000000000000000000006' }), // WETH
        transfer({ timeStamp: Date.parse('2026-08-31T15:00:00Z') / 1000 }),
      ],
    }))
    expect(plan.inserts).toEqual([])
  })
})

describe('planSync — ether.fi Cash', () => {
  const etherfi = (over: Partial<PlanInput> = {}) => base({
    account: { id: 'etherfi', walletAddress: ETHERFI, syncKind: 'etherfi_cash', syncSince: '2026-09-01' },
    siblings: [{ id: 'safe', walletAddress: SAFE }],
    ...over,
  })
  const spend = { chainId: 10, hash: '0xbbb', logIndex: 7, blockNumber: 200, timeStamp: TUE_NOON, totalUsdAmt: '12345678' } // $12.345678

  it('imports a Spend as an expend and ignores its settlement transfer', () => {
    const plan = planSync(etherfi({
      spends: [spend],
      transfers: [transfer({ chainId: 10, hash: '0xbbb', logIndex: 5, from: ETHERFI, to: OTHER, contractAddress: USDC_OP, value: '12345678' })],
    }))
    expect(plan.inserts).toEqual([{
      externalId: '10:0xbbb:7', type: 'expend', amount: 6484, usdAmount: 1235, // $12.345678 → 1235¢ × 5.25 = 6483.75
      date: '2026-09-22', accountId: 'etherfi', counterAccountId: null, note: 'ether.fi Cash',
    }])
  })

  it('skips top-ups: from the Safe directly, or bridged in matching a recorded transfer', () => {
    const plan = planSync(etherfi({
      transfers: [
        transfer({ from: SAFE, to: ETHERFI }), // Base deposit leg
        transfer({ chainId: 10, hash: '0xccc', from: OTHER, to: ETHERFI, contractAddress: USDC_OP, value: '99500000', timeStamp: TUE_NOON + DAY }), // bridged, −0.5% fee
      ],
      rates: { '2026-09-22': 5.25, '2026-09-23': 5.3 },
      transfersIn: [{ amount: 52500, usdAmount: 10000, date: '2026-09-22' }],
    }))
    expect(plan.inserts).toEqual([])
  })

  it('imports other incoming transfers (refunds) as earns', () => {
    const plan = planSync(etherfi({
      transfers: [transfer({ chainId: 10, from: OTHER, to: ETHERFI, contractAddress: USDC_OP, value: '5000000' })],
      transfersIn: [{ amount: 52500, usdAmount: 10000, date: '2026-09-22' }],
    }))
    expect(plan.inserts).toMatchObject([{ type: 'earn', usdAmount: 500, amount: 2625 }])
  })
})

describe('planSync — matching hermes/manual rows', () => {
  const outgoing = transfer({ from: SAFE, to: OTHER }) // expend R$ 525,00 on 2026-09-22

  it('claims a row within ±2 days and ±3% instead of inserting', () => {
    const plan = planSync(base({
      transfers: [outgoing],
      existing: [{ id: 'hermes', type: 'expend', amount: 51000, date: '2026-09-20' }],
    }))
    expect(plan.inserts).toEqual([])
    expect(plan.claims).toEqual([{ id: 'hermes', externalId: '8453:0xaaa:3', usdAmount: 10000 }])
  })

  it('inserts when nothing is close enough (type, date or amount)', () => {
    const plan = planSync(base({
      transfers: [outgoing],
      existing: [
        { id: 'wrong-type', type: 'earn', amount: 52500, date: '2026-09-22' },
        { id: 'too-late', type: 'expend', amount: 52500, date: '2026-09-25' },
        { id: 'too-far', type: 'expend', amount: 50000, date: '2026-09-22' }, // −4.8%
      ],
    }))
    expect(plan.inserts).toHaveLength(1)
    expect(plan.claims).toEqual([])
  })

  it('picks the closest amount, then the closest date', () => {
    const plan = planSync(base({
      transfers: [outgoing],
      existing: [
        { id: 'far-amount', type: 'expend', amount: 52000, date: '2026-09-22' },
        { id: 'close-amount-far-date', type: 'expend', amount: 52400, date: '2026-09-24' },
        { id: 'close-amount-near-date', type: 'expend', amount: 52600, date: '2026-09-23' },
      ],
    }))
    expect(plan.claims.map((c) => c.id)).toEqual(['close-amount-near-date'])
  })

  it('never claims the same row twice', () => {
    const plan = planSync(base({
      transfers: [outgoing, transfer({ from: SAFE, to: OTHER, logIndex: 4 })],
      existing: [{ id: 'hermes', type: 'expend', amount: 52500, date: '2026-09-22' }],
    }))
    expect(plan.claims).toHaveLength(1)
    expect(plan.inserts).toMatchObject([{ externalId: '8453:0xaaa:4' }])
  })
})

describe('PTAX', () => {
  it('uses the last business day rate on weekends', () => {
    const saturday = Date.parse('2026-09-26T15:00:00Z') / 1000
    const plan = planSync(base({ transfers: [transfer({ timeStamp: saturday })], rates: { '2026-09-25': 5.1 } }))
    expect(plan.inserts).toMatchObject([{ date: '2026-09-26', amount: 51000 }])
  })

  it('fails loudly when no rate is available', () => {
    expect(() => planSync(base({ transfers: [transfer()], rates: {} }))).toThrow(/PTAX/)
  })
})
