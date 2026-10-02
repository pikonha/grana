import { z } from 'zod'
import { checkHeaderSecret } from './auth'
import { pluggyEnabled } from './pluggy-config'

/** Header registered with the webhook (the Dashboard UI cannot set headers; see docs/open-finance.md). */
export const WEBHOOK_HEADER = 'x-webhook-secret'

const payload = z.object({ event: z.string(), itemId: z.string() })
export type PluggyWebhookEvent = z.infer<typeof payload>

const SYNC_EVENTS = new Set(['item/updated', 'transactions/created', 'transactions/updated', 'transactions/deleted'])
export const isRelevantEvent = (event: string) => SYNC_EVENTS.has(event) || event === 'item/error'

const json = (body: unknown, status: number) => Response.json(body, { status })

/**
 * Pluggy has no signature, only a custom header, so the payload is just a trigger: the
 * sync re-fetches with grana's own credentials. Auth runs BEFORE the body is parsed.
 */
export async function handlePluggyWebhook(request: Request, trigger: (event: PluggyWebhookEvent) => void) {
  if (!pluggyEnabled() || !process.env.PLUGGY_WEBHOOK_SECRET) return json({ error: 'Pluggy sync is not configured' }, 503)
  if (!checkHeaderSecret(request, WEBHOOK_HEADER, 'PLUGGY_WEBHOOK_SECRET')) return new Response('Unauthorized', { status: 401 })
  const body = payload.safeParse(await request.json().catch(() => null))
  if (!body.success) return json({ error: 'Invalid payload' }, 400)
  // Accepted right away: Pluggy times out at 10 s and retries; the sync runs in the background.
  if (isRelevantEvent(body.data.event)) trigger(body.data)
  return json({ accepted: true }, 202)
}
