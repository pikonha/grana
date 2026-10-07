import { describe, expect, it } from 'vitest'
import { parseSpendLog, parseTransferItem, parseTransferLog, planSync, usdCentsOf, type PlanInput } from './chain-sync'

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
      date: '2026-09-22', time: '12:00', accountId: 'safe', counterAccountId: null, note: null, // 15:00Z is noon in São Paulo
    }])
    expect(plan.claims).toEqual([])
  })

  it('imports an outgoing transfer to a stranger as an expend', () => {
    const plan = planSync(base({ transfers: [transfer({ from: SAFE, to: OTHER })] }))
    expect(plan.inserts).toMatchObject([{ type: 'expend', amount: 52500, counterAccountId: null }])
  })

  it('imports an outgoing transfer to another crypto account of the user as one transfer', () => {
    const plan = planSync(base({
      siblings: [{ id: 'etherfi', walletAddress: ETHERFI, syncKind: 'etherfi_cash' }],
      transfers: [transfer({ from: SAFE, to: ETHERFI })],
    }))
    expect(plan.inserts).toMatchObject([{ type: 'transfer', accountId: 'safe', counterAccountId: 'etherfi', note: 'Transferência' }])
  })

  it('leaves transfers between two synced wallets to the sender', () => {
    const plan = planSync(base({
      siblings: [{ id: 'other-safe', walletAddress: OTHER, syncKind: 'wallet' }],
      transfers: [transfer({ from: OTHER, to: SAFE })],
    }))
    expect(plan.inserts).toEqual([])
  })

  it('imports incoming from a sibling on a chain that sibling does not sync', () => {
    const plan = planSync(base({
      siblings: [{ id: 'etherfi', walletAddress: ETHERFI, syncKind: 'etherfi_cash' }], // OP only
      transfers: [transfer({ from: ETHERFI, to: SAFE })], // on Base
    }))
    expect(plan.inserts).toMatchObject([{ type: 'earn' }])
  })

  it('ignores zero-value transfers (address poisoning)', () => {
    expect(planSync(base({ transfers: [transfer({ from: SAFE, to: OTHER, value: '0' })] })).inserts).toEqual([])
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
    siblings: [{ id: 'safe', walletAddress: SAFE, syncKind: 'wallet' }],
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
      date: '2026-09-22', time: '12:00', accountId: 'etherfi', counterAccountId: null, note: 'ether.fi Cash',
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

  it('imports outgoing transfers outside a Spend (withdrawals) as expends', () => {
    const plan = planSync(etherfi({
      transfers: [transfer({ chainId: 10, hash: '0xddd', from: ETHERFI, to: OTHER, contractAddress: USDC_OP, value: '5000000' })],
    }))
    expect(plan.inserts).toMatchObject([{ type: 'expend', usdAmount: 500, note: null }])
  })

  it('lets one recorded top-up absorb only one bridged arrival', () => {
    const arrival = { chainId: 10, from: OTHER, to: ETHERFI, contractAddress: USDC_OP, value: '100000000' }
    const plan = planSync(etherfi({
      transfers: [transfer({ ...arrival, hash: '0xe1' }), transfer({ ...arrival, hash: '0xe2' })],
      transfersIn: [{ amount: 52500, usdAmount: 10000, date: '2026-09-22' }],
    }))
    expect(plan.inserts).toMatchObject([{ type: 'earn', externalId: '10:0xe2:3' }])
  })

  it('ignores moves to and from ether.fi Lend (the money is still on the card)', () => {
    const LEND = '0x01f8cdfb1694ea8fe4ed6c38a0fd78d1188e03f4'
    const plan = planSync(etherfi({
      transfers: [
        transfer({ chainId: 10, hash: '0xl1', from: ETHERFI, to: LEND, contractAddress: USDC_OP }),
        transfer({ chainId: 10, hash: '0xl2', from: LEND, to: ETHERFI, contractAddress: USDC_OP }),
      ],
    }))
    expect(plan.inserts).toEqual([])
  })

  it('labels ether.fi refunds and cashback', () => {
    const plan = planSync(etherfi({
      transfers: [
        transfer({ chainId: 10, hash: '0xr', from: '0xf6b3422e3cc70fa9fce4fab9a706ed2497c7bb9e', to: ETHERFI, contractAddress: USDC_OP }),
        transfer({ chainId: 10, hash: '0xc', from: '0xef55ec694b0b8273967f28627c5bc26f5deea836', to: ETHERFI, contractAddress: USDC_OP, value: '1000000' }),
      ],
    }))
    expect(plan.inserts.map((r) => r.note)).toEqual(['ether.fi Cash (reembolso)', 'ether.fi Cash (cashback)'])
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

  it('claims a recurrence occurrence up to 7 days off and takes the real amount and date', () => {
    const plan = planSync(base({
      transfers: [outgoing],
      existing: [
        { id: 'manual', type: 'expend', amount: 52500, date: '2026-09-17' },
        { id: 'rule', type: 'expend', amount: 52000, date: '2026-09-15', recurrenceRuleId: 'r1' },
      ],
    }))
    expect(plan.inserts).toEqual([])
    expect(plan.claims).toMatchObject([{ id: 'rule', actual: { amount: 52500, date: '2026-09-22' } }])
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

describe('log parsing', () => {
  it('decodes a real ether.fi Spend log (OP, $694.48 debit in USDT)', () => {
    const spend = parseSpendLog(10, {
      blockNumber: '0x9605be6', timeStamp: '0x6ab49185', logIndex: '0x95',
      transactionHash: '0x2d34840a74af6bbdefb54510e30b2603b9af20da2d53c6b8e4f2286fcc124259',
      topics: [
        '0x244f4cc0665ad7ee4709aa59b30d3ea581cecde1b0430a3f23a5dc609d4890fc',
        '0x000000000000000000000000f6f1c73f7ea024c53a82eee06bbf517631e8b8ac',
        '0xdada11b30c5d366a39c209293cb18dacd3db4ab044e29980d5020e8dbaafb297',
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      ],
      data: '0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000002964ec800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000094b008aa00579c1307b0ef2c499ad98a8ce58e580000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000002964ec800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000002964ec80',
    })
    expect(spend).toMatchObject({ safe: '0xf6f1c73f7ea024c53a82eee06bbf517631e8b8ac', totalUsdAmt: '694480000', logIndex: 149, blockNumber: 157309926 })
    expect(usdCentsOf(spend.totalUsdAmt)).toBe(69448)
  })

  it('decodes a real ERC20 Transfer log (Base USDC, JSON-RPC)', () => {
    const t = parseTransferLog(8453, {
      address: '0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913', blockNumber: '0x31dd000', timeStamp: '0x6ac5fce3', logIndex: '0x0',
      transactionHash: '0xf7498d1f30942ef08ddd19c86dc7dcadeeb40ef9c0f7c5be3a870cf5785defba',
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x000000000000000000000000565fe00e83c876740a3696bb46779c513af6916e',
        '0x0000000000000000000000006867ef8c1904a10e31d856ebbc5d6acf91dbe48a',
      ],
      data: '0x000000000000000000000000000000000000000000000000000000000dfdad27',
    })
    expect(t).toEqual({
      chainId: 8453, hash: '0xf7498d1f30942ef08ddd19c86dc7dcadeeb40ef9c0f7c5be3a870cf5785defba', logIndex: 0, blockNumber: 52285440, timeStamp: 0x6ac5fce3,
      from: '0x565fe00e83c876740a3696bb46779c513af6916e', to: '0x6867ef8c1904a10e31d856ebbc5d6acf91dbe48a',
      contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', value: '234728743',
    })
  })

  it('decodes a Blockscout token-transfers item', () => {
    const t = parseTransferItem(10, USDC_OP, {
      block_number: 156847410, log_index: 31, timestamp: '2026-09-22T15:00:00.000000Z', transaction_hash: '0xabc',
      from: { hash: '0x2222222222222222222222222222222222222222' }, to: { hash: '0x1111111111111111111111111111111111111111' },
      total: { value: '1000000000' },
    })
    expect(t).toEqual({ chainId: 10, hash: '0xabc', logIndex: 31, blockNumber: 156847410, timeStamp: TUE_NOON, from: ETHERFI, to: SAFE, contractAddress: USDC_OP, value: '1000000000' })
  })
})
