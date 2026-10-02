import { createFileRoute } from '@tanstack/react-router'
import { handlePluggyWebhook } from '#/server/pluggy-webhook'
import { syncPluggyItemEvent } from '#/server/chain-sync.core'

export const Route = createFileRoute('/api/pluggy/webhook')({
  server: { handlers: { POST: ({ request }) => handlePluggyWebhook(request, (event) => void syncPluggyItemEvent(event)) } },
})
