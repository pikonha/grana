import { describe, expect, it } from 'vitest'
import { MCP_TOOL_NAMES, registerFinanceTools } from './mcp-tools'
import { uniqueImportTagNames } from './transactions.core'

describe('MCP tool parity', () => {
  it('exposes every UI finance operation', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual([
      'create_account',
      'create_tag',
      'create_transaction',
      'create_transfer',
      'delete_account',
      'delete_installment_plan',
      'delete_recurrence_rule',
      'delete_tag',
      'delete_transaction',
      'import_transactions',
      'list_accounts',
      'list_faturas',
      'list_installment_plans',
      'list_recurrence_rules',
      'list_tags',
      'list_transactions',
      'mark_fatura_paid',
      'set_transaction_paid',
      'sync_account',
      'unmark_fatura_paid',
      'update_account',
      'update_recurrence_rule',
      'update_transaction',
      'update_transfer',
    ].sort())
  })

  it('registers exactly the declared tool inventory', () => {
    const registered: string[] = []
    const fakeServer = {
      registerTool: (name: string) => registered.push(name),
    } as unknown as Parameters<typeof registerFinanceTools>[0]

    registerFinanceTools(fakeServer, 'user-id')

    expect(registered.sort()).toEqual([...MCP_TOOL_NAMES].sort())
  })

  it('registers import_transactions with an object argument containing transactions', () => {
    const registered: Record<string, { inputSchema?: { parse: (value: unknown) => unknown } }> = {}
    const fakeServer = {
      registerTool: (name: string, config: { inputSchema?: { parse: (value: unknown) => unknown } }) => {
        registered[name] = config
      },
    } as unknown as Parameters<typeof registerFinanceTools>[0]

    registerFinanceTools(fakeServer, 'user-id')

    const inputSchema = registered.import_transactions.inputSchema
    expect(inputSchema).toBeDefined()
    expect(inputSchema?.parse({
      transactions: [{ type: 'expend', amount: 100, date: '2026-10-06', account_id: '00000000-0000-4000-8000-000000000001' }],
    })).toEqual({
      transactions: [{ type: 'expend', amount: 100, date: '2026-10-06', account_id: '00000000-0000-4000-8000-000000000001' }],
    })
    expect(() => inputSchema?.parse([{ type: 'expend', amount: 100, date: '2026-10-06', account_id: '00000000-0000-4000-8000-000000000001' }])).toThrow()
  })

  it('deduplicates import tag names after normalization', () => {
    expect(uniqueImportTagNames([
      { type: 'expend', amount: 100, date: '2026-10-06', account_id: '00000000-0000-4000-8000-000000000001', tag_names: [' Food ', 'food', 'Café'] },
      { type: 'earn', amount: 200, date: '2026-10-06', account_id: '00000000-0000-4000-8000-000000000001', tag_names: ['CAFE', 'Salary'] },
    ])).toEqual([' Food ', 'Café', 'Salary'])
  })
})
