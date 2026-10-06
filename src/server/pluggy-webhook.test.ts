import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePluggyWebhook } from './pluggy-webhook'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/api/pluggy/webhook', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers })
const authed = { 'x-webhook-secret': 's3cret' }

describe('handlePluggyWebhook', () => {
  const trigger = vi.fn()
  beforeEach(() => {
    vi.stubEnv('PLUGGY_CLIENT_ID', 'id'); vi.stubEnv('PLUGGY_CLIENT_SECRET', 'sec')
    vi.stubEnv('PLUGGY_ITEM_IDS', 'item-1'); vi.stubEnv('PLUGGY_WEBHOOK_SECRET', 's3cret')
    trigger.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('401 without the header, before the body is parsed', async () => {
    const res = await handlePluggyWebhook(post('not json'), trigger)
    expect(res.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('401 with a wrong secret', async () => {
    expect((await handlePluggyWebhook(post({}, { 'x-webhook-secret': 'nope!!' }), trigger)).status).toBe(401)
  })

  it('202 with the header, and triggers the event', async () => {
    const res = await handlePluggyWebhook(post({ event: 'item/updated', itemId: 'item-1' }, authed), trigger)
    expect(res.status).toBe(202)
    expect(trigger).toHaveBeenCalledWith({ event: 'item/updated', itemId: 'item-1' })
  })

  it('202 and no trigger for events it does not care about', async () => {
    const res = await handlePluggyWebhook(post({ event: 'item/created', itemId: 'item-1' }, authed), trigger)
    expect(res.status).toBe(202)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('400 on an invalid body once authorized', async () => {
    expect((await handlePluggyWebhook(post('not json', authed), trigger)).status).toBe(400)
  })

  it.each(['PLUGGY_CLIENT_ID', 'PLUGGY_ITEM_IDS', 'PLUGGY_WEBHOOK_SECRET'])('503 when %s is missing', async (name) => {
    vi.stubEnv(name, '')
    expect((await handlePluggyWebhook(post({}, authed), trigger)).status).toBe(503)
  })
})
