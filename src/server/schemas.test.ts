import { describe, expect, it } from 'vitest'
import { accountInput, createTransactionInput, faturaPaymentInput, transferInput, updateAccountInput, updateTransferInput, updateTransactionInput, webhookTransactionInput } from './schemas'
const base={type:'expend' as const,amount:1200,date:'2026-07-11'}
describe('createTransactionInput',()=>{
  it('accepts plain transactions',()=>expect(createTransactionInput.safeParse(base).success).toBe(true))
  it('accepts installments',()=>expect(createTransactionInput.safeParse({...base,installments:{count:3}}).success).toBe(true))
  it('rejects recurrence with installments',()=>expect(createTransactionInput.safeParse({...base,installments:{count:3},recurrence:{interval:'monthly'}}).success).toBe(false))
  it('rejects one installment',()=>expect(createTransactionInput.safeParse({...base,installments:{count:1}}).success).toBe(false))
})
describe('transferInput',()=>{
  const transferBase={amount:1200,date:'2026-07-11',account_id:'11111111-1111-4111-8111-111111111111',counter_account_id:'22222222-2222-4222-8222-222222222222'}
  it('defaults the transfer name',()=>expect(transferInput.parse(transferBase).note).toBe('Transferência'))
  it('keeps custom transfer names',()=>expect(transferInput.parse({...transferBase,note:'Reserva'}).note).toBe('Reserva'))
  it('requires an id and distinct accounts on update',()=>{
    expect(updateTransferInput.safeParse(transferBase).success).toBe(false)
    expect(updateTransferInput.safeParse({...transferBase,id:'33333333-3333-4333-8333-333333333333',counter_account_id:transferBase.account_id}).success).toBe(false)
    expect(updateTransferInput.parse({...transferBase,id:'33333333-3333-4333-8333-333333333333'}).note).toBe('Transferência')
  })
})
describe('update schemas',()=>{
  const id='11111111-1111-4111-8111-111111111111'
  it('accepts transaction edits without recurrence/installments',()=>expect(updateTransactionInput.safeParse({...base,id}).success).toBe(true))
  it('rejects transaction edits without an id',()=>expect(updateTransactionInput.safeParse(base).success).toBe(false))
  it('normalizes account names on create and update',()=>{
    expect(accountInput.parse({name:' Checking ',kind:'bank_account'}).name).toBe('Checking')
    expect(updateAccountInput.parse({id,name:' Visa ',kind:'credit_card',limit:1000,closingDay:5,dueDay:10}).name).toBe('Visa')
  })
})
describe('isoDate',()=>{
  it('rejects impossible dates',()=>{
    expect(createTransactionInput.safeParse({...base,date:'2026-13-01'}).success).toBe(false)
    expect(faturaPaymentInput.safeParse({account_id:'11111111-1111-4111-8111-111111111111',cycle_key:'2026-02-30'}).success).toBe(false)
  })
  it('accepts leap days',()=>expect(createTransactionInput.safeParse({...base,date:'2028-02-29'}).success).toBe(true))
})
describe('webhookTransactionInput',()=>{
  it('rejects unknown keys',()=>expect(webhookTransactionInput.safeParse({...base,card_id:'x'}).success).toBe(false))
  it('accepts known keys',()=>expect(webhookTransactionInput.safeParse(base).success).toBe(true))
})
describe('accountInput crypto sync',()=>{
  const safe={name:'Safe',kind:'bank_account' as const,walletAddress:'0xABCDEFabcdef0123456789012345678901234567',syncKind:'wallet' as const,syncSince:'2026-09-01'}
  it('lowercases the wallet address',()=>expect(accountInput.parse(safe).walletAddress).toBe('0xabcdefabcdef0123456789012345678901234567'))
  it('rejects malformed addresses',()=>expect(accountInput.safeParse({...safe,walletAddress:'0x123'}).success).toBe(false))
  it('requires kind and start date for crypto accounts',()=>expect(accountInput.safeParse({...safe,syncSince:undefined}).success).toBe(false))
  it('accepts null to clear the address',()=>expect(accountInput.parse({name:'Safe',kind:'bank_account',walletAddress:null}).walletAddress).toBeNull())
  it('keeps the refinements on update',()=>expect(updateAccountInput.safeParse({...safe,id:'11111111-1111-4111-8111-111111111111',syncKind:undefined}).success).toBe(false))
})
